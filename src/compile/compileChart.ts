// 主測試接縫:把單首歌的原始檔案 + 難度名 → TypingChart。純函式、可決定性。
// 唯一的正規化點:自己 JSON.parse、換算時間、映射。無 I/O、音訊、渲染。
//
// issue 01 範圍:v2、基本紅/藍音符、空間順序映射、單一全域 BPM + _songTimeOffset。
// 延後:v3(02)、同拍 burst / 內側鍵 / 弧線 hold / 炸彈牆鏈過濾細節(03)。
import { mapNote } from './mapping.ts';
import { parseInfo } from './parseInfo.ts';
import type { CompileConfig, Note, RawMapFiles, TypingChart } from './types.ts';

interface RawV2Note {
  _time?: number;
  _lineIndex?: number;
  _lineLayer?: number;
  _type?: number;
}
interface RawV2Difficulty {
  version?: string; // v3 用 "version" + "colorNotes";v2 沒有
  colorNotes?: unknown; // v3 標記
  _notes?: RawV2Note[];
}

/**
 * 把原始譜面檔編譯成 TypingChart。
 * @param rawMapFiles 單首歌的原始檔案(未解析文字)
 * @param difficultyName 要編譯的難度名(如 "ExpertPlus")
 * @param _config 編譯期組態(01 未使用)
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

  let diff: RawV2Difficulty;
  try {
    diff = JSON.parse(diffText) as RawV2Difficulty;
  } catch {
    throw new Error(`難度檔「${ref.filename}」不是合法 JSON`);
  }

  if (diff.colorNotes !== undefined || (diff.version ?? '').startsWith('3')) {
    throw new Error('v3 譜面尚未支援(將於 issue 02 加入)');
  }
  if (!Array.isArray(diff._notes)) {
    throw new Error(`難度檔「${ref.filename}」缺少 _notes 陣列`);
  }

  const secPerBeat = 60 / info.bpm;
  const notes: Note[] = [];

  for (const n of diff._notes) {
    const color = n._type;
    // 只保留紅(0)/藍(1)音符;炸彈(3)與其他一律濾除。
    if (color !== 0 && color !== 1) continue;

    const beat = n._time ?? 0;
    const column = n._lineIndex ?? 0;
    const layer = n._lineLayer ?? 0;
    const mapped = mapNote(color, column, layer);

    notes.push({
      tSec: beat * secPerBeat + info.songTimeOffset,
      key: mapped.key,
      kind: 'press',
      hand: mapped.hand,
      finger: mapped.finger,
      bank: mapped.bank,
    });
  }

  // 依 tSec 穩定排序(相同時間點維持原始順序;01 範例不重疊)。
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.tSec - b.note.tSec || a.index - b.index)
    .map(({ note }) => note);
}
