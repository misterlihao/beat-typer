// 主測試接縫:把單首歌的原始檔案 + 難度名 → TypingChart。純函式、可決定性。
// 唯一的正規化點:自己 JSON.parse、換算時間、映射。無 I/O、音訊、渲染。
//
// issue 03 範圍:同手疊放收斂成單一內側鍵(見 docs/adr/0006)、v3 弧線→hold、炸彈牆鏈過濾。
import { innerKeyFor, layerToBank, mapNote } from './mapping.ts';
import { parseInfo } from './parseInfo.ts';
import type { Bank, CompileConfig, Note, RawMapFiles, TypingChart } from './types.ts';

// 同手兩顆相距 < 此值(beat)即視為「疊放」(一次揮砍),否則為連打。見 docs/adr/0006。
const STACK_BEAT_THRESHOLD = 1 / 8;

// ── 各格式的原始形狀(僅本作用得到的欄位)────────────────────
interface RawV2Note {
  _time?: number;
  _lineIndex?: number;
  _lineLayer?: number;
  _type?: number;
}
interface RawV3Note {
  b?: number; // beat
  x?: number; // 欄
  y?: number; // 列
  c?: number; // 顏色(0紅/1藍)
}
interface RawV3Slider {
  c?: number; // 顏色
  b?: number; // head beat
  x?: number; // head 欄
  y?: number; // head 列
  tb?: number; // tail beat
  tx?: number; // tail 欄
  ty?: number; // tail 列
}
interface RawDifficulty {
  version?: string; // v3:"3.x"
  _version?: string; // v2:"2.x"
  colorNotes?: unknown; // v3 音符陣列
  sliders?: unknown; // v3 弧線陣列
  _notes?: unknown; // v2 音符陣列
}

// 格式無關的正規化音符(內部中繼;v2/v3 差異在此收斂後不再外露)。
interface NormalizedNote {
  readonly beat: number;
  readonly column: number;
  readonly layer: number;
  readonly color: number;
}
// 正規化弧線:head + tail;之後轉成一顆 hold,並用來濾除重疊的 press。
interface NormalizedHold extends NormalizedNote {
  readonly endBeat: number;
  readonly endColumn: number;
  readonly endLayer: number;
}
interface NormalizedDiff {
  readonly presses: NormalizedNote[];
  readonly holds: NormalizedHold[];
}

/** 判定難度檔格式:version 字串為主判準,音符陣列存在與否為後備。 */
function detectFormat(diff: RawDifficulty): 'v2' | 'v3' | null {
  const version = diff.version ?? diff._version ?? '';
  if (version.startsWith('3')) return 'v3';
  if (version.startsWith('2')) return 'v2';
  if (Array.isArray(diff.colorNotes)) return 'v3';
  if (Array.isArray(diff._notes)) return 'v2';
  return null;
}

/** v2:讀 _notes,濾除炸彈(type 3)與其他非紅藍音符。v2 弧線 v1 不支援。 */
function normalizeV2(diff: RawDifficulty, filename: string): NormalizedDiff {
  if (!Array.isArray(diff._notes)) {
    throw new Error(`難度檔「${filename}」缺少 _notes 陣列`);
  }
  const presses: NormalizedNote[] = [];
  for (const n of diff._notes as RawV2Note[]) {
    const color = n._type;
    if (color !== 0 && color !== 1) continue; // 只保留紅(0)/藍(1)
    presses.push({ beat: n._time ?? 0, column: n._lineIndex ?? 0, layer: n._lineLayer ?? 0, color });
  }
  return { presses, holds: [] };
}

/**
 * v3:讀 colorNotes 與 sliders(弧線→hold)。
 * 炸彈/牆/鏈條在各自陣列,不讀即濾。與弧線 head/tail 精確重疊的 colorNote 濾掉,避免 press+hold 並存。
 */
function normalizeV3(diff: RawDifficulty, filename: string): NormalizedDiff {
  if (!Array.isArray(diff.colorNotes)) {
    throw new Error(`難度檔「${filename}」缺少 colorNotes 陣列`);
  }

  const holds: NormalizedHold[] = [];
  for (const s of (Array.isArray(diff.sliders) ? diff.sliders : []) as RawV3Slider[]) {
    const color = s.c;
    if (color !== 0 && color !== 1) continue;
    holds.push({
      beat: s.b ?? 0,
      column: s.x ?? 0,
      layer: s.y ?? 0,
      color,
      endBeat: s.tb ?? 0,
      endColumn: s.tx ?? 0,
      endLayer: s.ty ?? 0,
    });
  }

  // 弧線 head/tail 佔用的 (beat,欄,列,顏色) 集合,用來濾掉重疊的 colorNote。
  const occupied = new Set<string>();
  const cell = (beat: number, column: number, layer: number, color: number) =>
    `${beat}|${column}|${layer}|${color}`;
  for (const h of holds) {
    occupied.add(cell(h.beat, h.column, h.layer, h.color));
    occupied.add(cell(h.endBeat, h.endColumn, h.endLayer, h.color));
  }

  const presses: NormalizedNote[] = [];
  for (const n of diff.colorNotes as RawV3Note[]) {
    const color = n.c;
    if (color !== 0 && color !== 1) continue;
    const beat = n.b ?? 0;
    const column = n.x ?? 0;
    const layer = n.y ?? 0;
    if (occupied.has(cell(beat, column, layer, color))) continue; // 由弧線接手
    presses.push({ beat, column, layer, color });
  }
  return { presses, holds };
}

/** 依格式把難度檔正規化。唯一的 v2/v3 分流點。 */
function normalizeDiff(diff: RawDifficulty, filename: string): NormalizedDiff {
  const format = detectFormat(diff);
  if (format === 'v3') return normalizeV3(diff, filename);
  if (format === 'v2') return normalizeV2(diff, filename);
  const seen = diff.version ?? diff._version ?? '(未標示)';
  throw new Error(`不支援的譜面版本「${seen}」(目前支援 v2/v3)`);
}

/** 顏色→手(紅0=左、藍1=右)。 */
function handOf(color: number): 'left' | 'right' {
  return color === 0 ? 'left' : 'right';
}

/**
 * 同手疊放收斂:把 press 音符依手分組、手內依 beat 用錨點制成群。
 * 群大小 1 → 正常映射;群大小 ≥2(疊放)→ 收斂成一顆內側鍵音符(列取錨點)。見 docs/adr/0006。
 */
function collapseStacks(presses: NormalizedNote[], secPerBeat: number, offset: number): Note[] {
  const byHand: Record<'left' | 'right', NormalizedNote[]> = { left: [], right: [] };
  for (const p of presses) byHand[handOf(p.color)].push(p);

  const out: Note[] = [];
  for (const hand of ['left', 'right'] as const) {
    const group = byHand[hand].slice().sort((a, b) => a.beat - b.beat);
    let i = 0;
    while (i < group.length) {
      const anchor = group[i]!;
      // 錨點制:只跟該群第一顆比,避免鏈式串接。
      let j = i + 1;
      while (j < group.length && group[j]!.beat - anchor.beat < STACK_BEAT_THRESHOLD) j++;
      const size = j - i;
      const tSec = anchor.beat * secPerBeat + offset;

      if (size === 1) {
        const m = mapNote(anchor.color, anchor.column, anchor.layer);
        out.push({ tSec, key: m.key, kind: 'press', hand: m.hand, finger: m.finger, bank: m.bank });
      } else {
        // 疊放 → 單一內側鍵,列取錨點。
        const bank: Bank = layerToBank(anchor.layer);
        out.push({ tSec, key: innerKeyFor(hand, bank), kind: 'press', hand, finger: 'index', bank });
      }
      i = j;
    }
  }
  return out;
}

/**
 * 把原始譜面檔編譯成 TypingChart。
 * @param rawMapFiles 單首歌的原始檔案(未解析文字)
 * @param difficultyName 要編譯的難度名(如 "ExpertPlus")
 * @param _config 編譯期組態(尚未使用)
 */
export function compileChart(
  rawMapFiles: RawMapFiles,
  difficultyName: string,
  _config: CompileConfig = {},
): TypingChart {
  const info = parseInfo(rawMapFiles.infoText);

  const ref = info.difficulties.find((d) => d.difficulty === difficultyName);
  if (!ref) {
    const names = info.difficulties.map((d) => d.difficulty).join(', ');
    throw new Error(`找不到難度「${difficultyName}」;可用難度:${names}`);
  }

  const diffText = rawMapFiles.difficultyFiles[ref.filename];
  if (diffText === undefined) {
    throw new Error(`缺少難度檔「${ref.filename}」`);
  }

  let diff: RawDifficulty;
  try {
    diff = JSON.parse(diffText) as RawDifficulty;
  } catch {
    throw new Error(`難度檔「${ref.filename}」不是合法 JSON`);
  }

  const { presses, holds } = normalizeDiff(diff, ref.filename);
  const secPerBeat = 60 / info.bpm;
  const offset = info.songTimeOffset;

  // press:疊放收斂;hold:弧線 head→tail,不參與疊放分組。
  const notes: Note[] = collapseStacks(presses, secPerBeat, offset);
  for (const h of holds) {
    const m = mapNote(h.color, h.column, h.layer);
    notes.push({
      tSec: h.beat * secPerBeat + offset,
      key: m.key,
      kind: 'hold',
      holdEndSec: h.endBeat * secPerBeat + offset,
      hand: m.hand,
      finger: m.finger,
      bank: m.bank,
    });
  }

  // 依 tSec 穩定排序(相同時間點維持原始順序;跨手同拍可共用時間)。
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.tSec - b.note.tSec || a.index - b.index)
    .map(({ note }) => note);
}
