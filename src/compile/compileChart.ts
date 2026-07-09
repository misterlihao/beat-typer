// 主測試接縫:把單首歌的原始檔案 + 難度名 → TypingChart。純函式、可決定性。
// 唯一的正規化點:自己 JSON.parse、換算時間、映射。無 I/O、音訊、渲染。
//
// issue 02 範圍:v2 + v3 皆支援,兩格式先正規化成 NormalizedNote 再走同一條映射邏輯。
// 延後:同拍 burst / 內側鍵 / 弧線 hold / 炸彈牆鏈的細部過濾與轉換(03)。
import { mapNote } from './mapping.ts';
import { parseInfo } from './parseInfo.ts';
import type { CompileConfig, Note, RawMapFiles, TypingChart } from './types.ts';

// ── 各格式的原始音符形狀(僅本作用得到的欄位)──────────────
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
interface RawDifficulty {
  version?: string; // v3:"3.x"
  _version?: string; // v2:"2.x"
  colorNotes?: unknown; // v3 音符陣列
  _notes?: unknown; // v2 音符陣列
}

// 格式無關的正規化音符(內部中繼;v2/v3 差異在此收斂後不再外露)。
interface NormalizedNote {
  readonly beat: number;
  readonly column: number;
  readonly layer: number;
  readonly color: number;
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

/** v2:讀 _notes,濾除炸彈(type 3)與其他非紅藍音符。 */
function normalizeV2(diff: RawDifficulty, filename: string): NormalizedNote[] {
  if (!Array.isArray(diff._notes)) {
    throw new Error(`難度檔「${filename}」缺少 _notes 陣列`);
  }
  const out: NormalizedNote[] = [];
  for (const n of diff._notes as RawV2Note[]) {
    const color = n._type;
    if (color !== 0 && color !== 1) continue; // 只保留紅(0)/藍(1)
    out.push({ beat: n._time ?? 0, column: n._lineIndex ?? 0, layer: n._lineLayer ?? 0, color });
  }
  return out;
}

/** v3:只讀 colorNotes(炸彈/牆/鏈/弧在各自陣列,本切片不碰);仍防衛性保留 0/1 過濾。 */
function normalizeV3(diff: RawDifficulty, filename: string): NormalizedNote[] {
  if (!Array.isArray(diff.colorNotes)) {
    throw new Error(`難度檔「${filename}」缺少 colorNotes 陣列`);
  }
  const out: NormalizedNote[] = [];
  for (const n of diff.colorNotes as RawV3Note[]) {
    const color = n.c;
    if (color !== 0 && color !== 1) continue;
    out.push({ beat: n.b ?? 0, column: n.x ?? 0, layer: n.y ?? 0, color });
  }
  return out;
}

/** 依格式把難度檔正規化成格式無關的音符陣列。唯一的 v2/v3 分流點。 */
function normalizeNotes(diff: RawDifficulty, filename: string): NormalizedNote[] {
  const format = detectFormat(diff);
  if (format === 'v3') return normalizeV3(diff, filename);
  if (format === 'v2') return normalizeV2(diff, filename);
  const seen = diff.version ?? diff._version ?? '(未標示)';
  throw new Error(`不支援的譜面版本「${seen}」(目前支援 v2/v3)`);
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

  const normalized = normalizeNotes(diff, ref.filename);
  const secPerBeat = 60 / info.bpm;

  const notes: Note[] = normalized.map((rn) => {
    const mapped = mapNote(rn.color, rn.column, rn.layer);
    return {
      tSec: rn.beat * secPerBeat + info.songTimeOffset,
      key: mapped.key,
      kind: 'press',
      hand: mapped.hand,
      finger: mapped.finger,
      bank: mapped.bank,
    };
  });

  // 依 tSec 穩定排序(相同時間點維持原始順序;同拍 burst 展開於 issue 03)。
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.tSec - b.note.tSec || a.index - b.index)
    .map(({ note }) => note);
}
