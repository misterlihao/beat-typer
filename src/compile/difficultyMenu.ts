// 難度選單支援(issue 17):純函式,供選單排序/分組與 NPS 粗估。不含 I/O / 渲染。
import type { DifficultyRef } from './types.ts';

// 標準難度序;不在表內的排最後。
const DIFFICULTY_ORDER = ['Easy', 'Normal', 'Hard', 'Expert', 'ExpertPlus'];

export interface DifficultyGroup {
  readonly characteristic: string;
  readonly difficulties: readonly DifficultyRef[];
}

/**
 * 難度選單排序/分組:濾掉 Lightshow(無音符),依 characteristic 分組,
 * 組內按標準難度序 Easy→ExpertPlus(未知難度排最後),Standard 組優先。純函式。
 */
export function buildDifficultyMenu(difficulties: readonly DifficultyRef[]): DifficultyGroup[] {
  const rank = (name: string) => {
    const i = DIFFICULTY_ORDER.indexOf(name);
    return i === -1 ? DIFFICULTY_ORDER.length : i;
  };
  const byChar = new Map<string, DifficultyRef[]>();
  for (const d of difficulties) {
    if (d.characteristic === 'Lightshow') continue;
    let arr = byChar.get(d.characteristic);
    if (!arr) byChar.set(d.characteristic, (arr = []));
    arr.push(d);
  }
  const groups: DifficultyGroup[] = [];
  for (const [characteristic, arr] of byChar) {
    arr.sort((a, b) => rank(a.difficulty) - rank(b.difficulty));
    groups.push({ characteristic, difficulties: arr });
  }
  // Standard 組優先,其餘維持首次出現順序。
  groups.sort((a, b) => Number(b.characteristic === 'Standard') - Number(a.characteristic === 'Standard'));
  return groups;
}

interface RawNote {
  _type?: number;
  _time?: number;
  b?: number;
}
interface RawDiffFile {
  colorNotes?: unknown;
  _notes?: unknown;
}

/**
 * 粗數難度檔的音符數與最後一顆音符 beat(供 NPS 粗估)。純函式。
 * v3:讀 colorNotes(beat=b);v2:讀 _notes 並濾掉炸彈(_type 3,beat=_time)。
 * 解析失敗 / 無音符 → {count:0, lastBeat:0}。
 */
export function noteStats(diffText: string): { count: number; lastBeat: number } {
  let diff: RawDiffFile;
  try {
    diff = JSON.parse(diffText) as RawDiffFile;
  } catch {
    return { count: 0, lastBeat: 0 };
  }
  let count = 0;
  let lastBeat = 0;
  if (Array.isArray(diff.colorNotes)) {
    for (const n of diff.colorNotes as RawNote[]) {
      count++;
      const b = typeof n.b === 'number' ? n.b : 0;
      if (b > lastBeat) lastBeat = b;
    }
  } else if (Array.isArray(diff._notes)) {
    for (const n of diff._notes as RawNote[]) {
      if (n._type !== 0 && n._type !== 1) continue; // 只數紅藍音符,濾炸彈(3)與其他
      count++;
      const b = typeof n._time === 'number' ? n._time : 0;
      if (b > lastBeat) lastBeat = b;
    }
  }
  return { count, lastBeat };
}
