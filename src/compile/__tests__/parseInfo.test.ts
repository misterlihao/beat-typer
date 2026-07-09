// parseInfo 的歌名解析(issue 04 新增 songName 欄位)。
import { describe, expect, it } from 'vitest';
import { parseInfo, pickPlayableDifficulty } from '../parseInfo.ts';
import type { DifficultyRef } from '../types.ts';

const base = {
  _beatsPerMinute: 120,
  _songFilename: 'song.egg',
  _difficultyBeatmapSets: [
    { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Hard', _beatmapFilename: 'HardStandard.dat' }] },
  ],
};

describe('parseInfo songName', () => {
  it('解出 _songName', () => {
    expect(parseInfo(JSON.stringify({ ...base, _songName: 'Pale' })).songName).toBe('Pale');
  });

  it('缺 _songName → undefined(交由呼叫端 fallback)', () => {
    expect(parseInfo(JSON.stringify(base)).songName).toBeUndefined();
  });

  it('_songName 為空字串 → undefined', () => {
    expect(parseInfo(JSON.stringify({ ...base, _songName: '' })).songName).toBeUndefined();
  });
});

const diff = (characteristic: string, difficulty: string): DifficultyRef => ({
  characteristic,
  difficulty,
  filename: `${difficulty}${characteristic}.dat`,
});

describe('pickPlayableDifficulty', () => {
  it('略過無音符的 Lightshow,即使它排在最前(hagu.zip 情境)', () => {
    const picked = pickPlayableDifficulty([
      diff('Lightshow', 'ExpertPlus'),
      diff('Standard', 'Hard'),
      diff('Standard', 'Expert'),
    ]);
    expect(picked).toEqual(diff('Standard', 'Hard'));
  });

  it('優先 Standard 特性', () => {
    const picked = pickPlayableDifficulty([diff('OneSaber', 'Expert'), diff('Standard', 'Normal')]);
    expect(picked.characteristic).toBe('Standard');
  });

  it('無 Standard 時取剩下的第一個', () => {
    const picked = pickPlayableDifficulty([diff('OneSaber', 'Expert'), diff('90Degree', 'Hard')]);
    expect(picked).toEqual(diff('OneSaber', 'Expert'));
  });

  it('全是 Lightshow 這種極端情況仍回傳第一個(不至於崩潰)', () => {
    const picked = pickPlayableDifficulty([diff('Lightshow', 'ExpertPlus')]);
    expect(picked).toEqual(diff('Lightshow', 'ExpertPlus'));
  });
});
