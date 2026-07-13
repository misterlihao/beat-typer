// 譜面燈光 → 標準化燈光時間線(issue 24 第一階段:經典事件模型)。
// 與 compileChart 並列的純函式接縫:解析 + beat→秒都在 compile 層、可測、共用 buildBeatToSec/rawDifficulty,
// 但不塞進 compileChart 回傳(燈光與 TypingChart 正交,不影響音符/判定/計分)。無 I/O、音訊、渲染。
//
// 涵蓋:v2 `_events` + v3 `basicBeatmapEvents`(經典 et/i/f 模型)。新版 `lightColorEventBoxGroups` → issue 24b。
// 顏色鏈:逐事件 Chroma `_color` → 每難度 env 覆寫(Info `_envColor*`)→ 本作預設淡紅藍。跳過環境原廠色。
import { buildBeatToSec } from './bpmTimeline.ts';
import { parseInfo } from './parseInfo.ts';
import { detectFormat, readBpmTimeline, type RawDifficultyMeta } from './rawDifficulty.ts';
import type { RawMapFiles } from './types.ts';

/** RGB(各 0..1)。強度另計於 brightness。 */
export interface LightColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type LightAction = 'off' | 'on' | 'flash' | 'fade';

/** 標準化的一筆燈光事件:某時刻某燈組做某動作,帶已解出的顏色與亮度。 */
export interface LightEvent {
  /** 相對音訊起點的秒數(已含 songTimeOffset);與音符同一時鐘。 */
  readonly tSec: number;
  /** 燈組 id(原始 et / _type);sink 依實際出現的組數程序化生等量發光體。 */
  readonly group: number;
  readonly action: LightAction;
  /** 已解析顏色(Chroma / env 覆寫 / 預設淡紅藍)。 */
  readonly color: LightColor;
  /** 目標亮度倍率(floatValue × Chroma alpha,夾 [0,2]);off 為 0。 */
  readonly brightness: number;
}

/** compileLightShow 的輸出:依 tSec 排序的標準化燈光時間線(空=無燈光,sink 退化為呼吸)。 */
export type LightShow = readonly LightEvent[];

// 旋轉 / 轉速 / 色 boost 類事件型別——非「顏色燈」,其值是旋轉量/轉速/調色盤切換而非顏色碼,直接忽略。
// (5=色 boost、8=環旋轉、9=環縮放、12/13=雷射轉速、14/15=旋轉。)
const NON_LIGHT_TYPES = new Set([5, 8, 9, 12, 13, 14, 15]);

// 亮度上限:Chroma alpha 可為 >1 的 HDR 強度,夾住避免過曝。
const MAX_BRIGHTNESS = 2;

// 本作預設淡紅藍(偏淡偏暗):譜面完全沒指定顏色時用。左=紅系(color0)、右=藍系(color1)。
const DEFAULT_LEFT: LightColor = { r: 0.55, g: 0.24, b: 0.28 };
const DEFAULT_RIGHT: LightColor = { r: 0.28, g: 0.4, b: 0.6 };
const DEFAULT_WHITE: LightColor = { r: 0.5, g: 0.5, b: 0.55 };

type ColorSlot = 'left' | 'right' | 'white';

interface EnvColors {
  readonly left?: LightColor;
  readonly right?: LightColor;
  readonly white?: LightColor;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * 解碼經典燈光值(v2 `_value` / v3 `i`):同時編了顏色側與動作。
 * 0=off;1藍/5紅=on;2藍/6紅=flash;3藍/7紅=fade;藍側 1~4、紅側 5~7、其餘(8+)當白;未知動作當 on。
 */
function decodeValue(v: number): { action: LightAction; slot: ColorSlot } {
  if (v === 0) return { action: 'off', slot: 'left' }; // off:顏色不重要
  const action: LightAction =
    v === 2 || v === 6 || v === 10 ? 'flash' : v === 3 || v === 7 || v === 11 ? 'fade' : 'on';
  const slot: ColorSlot = v >= 1 && v <= 4 ? 'right' : v >= 5 && v <= 7 ? 'left' : 'white';
  return { action, slot };
}

/** 讀 Chroma 逐事件顏色 `_color`/`color = [r,g,b,a]`;a 為強度(可 >1)。無則 null。 */
function readChroma(cd: unknown): { color: LightColor; alpha: number } | null {
  if (cd === null || typeof cd !== 'object') return null;
  const c = (cd as Record<string, unknown>)._color ?? (cd as Record<string, unknown>).color;
  if (!Array.isArray(c) || c.length < 3) return null;
  const [r, g, b, a] = c as unknown[];
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return { color: { r: clamp01(r), g: clamp01(g), b: clamp01(b) }, alpha: typeof a === 'number' ? a : 1 };
}

/** 把 Info 的 `_envColorLeft/Right/White`({r,g,b})轉成 LightColor;缺/非數回 undefined。 */
function toColor(o: unknown): LightColor | undefined {
  if (o === null || typeof o !== 'object') return undefined;
  const { r, g, b } = o as Record<string, unknown>;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return undefined;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/** 從 Info.dat 讀該難度檔的 env 顏色覆寫(每難度 `_customData`);跳過 boost。 */
function readEnvColors(infoText: string, filename: string): EnvColors {
  try {
    const info = JSON.parse(infoText) as {
      _difficultyBeatmapSets?: {
        _difficultyBeatmaps?: { _beatmapFilename?: string; _customData?: Record<string, unknown> }[];
      }[];
    };
    for (const set of info._difficultyBeatmapSets ?? []) {
      for (const d of set._difficultyBeatmaps ?? []) {
        if (d._beatmapFilename === filename) {
          const cd = d._customData ?? {};
          return {
            left: toColor(cd._envColorLeft),
            right: toColor(cd._envColorRight),
            white: toColor(cd._envColorWhite),
          };
        }
      }
    }
  } catch {
    // Info 已由 parseInfo 驗過合法;此處失敗只代表無 env 覆寫 → 落預設
  }
  return {};
}

/** 依顏色鏈解出某事件顏色:Chroma > env 覆寫 > 預設淡紅藍。 */
function resolveColor(chroma: LightColor | null, slot: ColorSlot, env: EnvColors): LightColor {
  if (chroma) return chroma;
  if (slot === 'left') return env.left ?? DEFAULT_LEFT;
  if (slot === 'right') return env.right ?? DEFAULT_RIGHT;
  return env.white ?? DEFAULT_WHITE;
}

// 一筆原始燈光事件(v2/v3 欄位皆可能存在;讀取時依格式取)。
interface RawLightEvent {
  _time?: number;
  _type?: number;
  _value?: number;
  _floatValue?: number;
  _customData?: unknown;
  b?: number;
  et?: number;
  i?: number;
  f?: number;
  customData?: unknown;
}

/**
 * 把單首歌某難度的譜面燈光編譯成標準化 LightShow(issue 24 第一階段)。
 * 無燈光 / 格式不支援 / 難度缺漏一律回空陣列(燈光為選配,優雅退化,不丟錯)。
 * @param rawMapFiles 單首歌的原始檔案(與 compileChart 同一份)
 * @param difficultyName 難度名(如 "ExpertPlus")
 */
export function compileLightShow(rawMapFiles: RawMapFiles, difficultyName: string): LightShow {
  let info;
  try {
    info = parseInfo(rawMapFiles.infoText);
  } catch {
    return [];
  }
  const ref = info.difficulties.find((d) => d.difficulty === difficultyName);
  if (!ref) return [];
  const diffText = rawMapFiles.difficultyFiles[ref.filename];
  if (diffText === undefined) return [];

  let diff: RawDifficultyMeta & { basicBeatmapEvents?: unknown; _events?: unknown };
  try {
    diff = JSON.parse(diffText) as typeof diff;
  } catch {
    return [];
  }
  const format = detectFormat(diff);
  if (!format) return [];

  const rawEvents = format === 'v3' ? diff.basicBeatmapEvents : diff._events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return [];

  // beat→秒:與 compileChart 同源(readBpmTimeline + buildBeatToSec),確保燈光與音符同一時鐘、變速對齊。
  const beatToSec = buildBeatToSec(readBpmTimeline(diff, format), info.bpm);
  const offset = info.songTimeOffset;
  const env = readEnvColors(rawMapFiles.infoText, ref.filename);

  const out: LightEvent[] = [];
  for (const e of rawEvents as RawLightEvent[]) {
    const type = format === 'v3' ? e.et : e._type;
    if (typeof type !== 'number' || NON_LIGHT_TYPES.has(type)) continue;
    const beat = format === 'v3' ? e.b : e._time;
    if (typeof beat !== 'number') continue;

    const value = format === 'v3' ? e.i : e._value;
    const { action, slot } = decodeValue(typeof value === 'number' ? value : 0);
    const floatVal = format === 'v3' ? e.f : e._floatValue;
    const cd = format === 'v3' ? e.customData : e._customData;
    const chroma = readChroma(cd);

    const color = resolveColor(chroma?.color ?? null, slot, env);
    const brightness =
      action === 'off'
        ? 0
        : Math.min(MAX_BRIGHTNESS, Math.max(0, (typeof floatVal === 'number' ? floatVal : 1) * (chroma?.alpha ?? 1)));

    out.push({ tSec: beatToSec(beat) + offset, group: type, action, color, brightness });
  }

  // 依 (tSec, group) 排序後收斂:同一時刻同組的多筆(Chroma `_lightID` 對單顆燈的展開)只保留最後一筆,
  // 因為 sink 一組只有一個發光體(忽略 lightID)。收斂後仍以 tSec 非遞減,供 sink 游標順掃。
  out.sort((a, b) => a.tSec - b.tSec || a.group - b.group);
  const collapsed: LightEvent[] = [];
  for (const e of out) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.tSec === e.tSec && last.group === e.group) collapsed[collapsed.length - 1] = e;
    else collapsed.push(e);
  }
  return collapsed;
}
