// Info.dat 的淺解析:取出難度選單與時間換算所需欄位。純函式。
// 供難度選單與 compileChart 共用,使讀檔(I/O)留在編排層(見 docs/adr/0005)。
import type { DifficultyRef, SongInfo } from './types.ts';

interface RawDifficultyBeatmap {
  _difficulty?: string;
  _beatmapFilename?: string;
}
interface RawDifficultySet {
  _beatmapCharacteristicName?: string;
  _difficultyBeatmaps?: RawDifficultyBeatmap[];
}
interface RawInfo {
  _beatsPerMinute?: number;
  _songTimeOffset?: number;
  _songFilename?: string;
  _difficultyBeatmapSets?: RawDifficultySet[];
}

/** 解析 Info.dat 文字 → SongInfo。格式不符時丟出清楚錯誤。 */
export function parseInfo(infoText: string): SongInfo {
  let raw: RawInfo;
  try {
    raw = JSON.parse(infoText) as RawInfo;
  } catch {
    throw new Error('Info.dat 不是合法 JSON');
  }

  const bpm = raw._beatsPerMinute;
  if (typeof bpm !== 'number' || !(bpm > 0)) {
    throw new Error(`Info.dat 缺少有效的 _beatsPerMinute(得到 ${String(bpm)})`);
  }
  const audioFilename = raw._songFilename;
  if (typeof audioFilename !== 'string' || audioFilename.length === 0) {
    throw new Error('Info.dat 缺少 _songFilename');
  }

  const difficulties: DifficultyRef[] = [];
  for (const set of raw._difficultyBeatmapSets ?? []) {
    const characteristic = set._beatmapCharacteristicName ?? 'Standard';
    for (const d of set._difficultyBeatmaps ?? []) {
      if (typeof d._difficulty === 'string' && typeof d._beatmapFilename === 'string') {
        difficulties.push({
          characteristic,
          difficulty: d._difficulty,
          filename: d._beatmapFilename,
        });
      }
    }
  }
  if (difficulties.length === 0) {
    throw new Error('Info.dat 未列出任何難度');
  }

  return {
    bpm,
    songTimeOffset: typeof raw._songTimeOffset === 'number' ? raw._songTimeOffset : 0,
    audioFilename,
    difficulties,
  };
}
