// 難度選單純函式驗收(issue 17):分組/排序/濾 Lightshow 與 NPS 音符統計。
import { describe, expect, it } from 'vitest';
import { buildDifficultyMenu, noteStats } from '../difficultyMenu.ts';
import type { DifficultyRef } from '../types.ts';

const ref = (characteristic: string, difficulty: string): DifficultyRef => ({
  characteristic,
  difficulty,
  filename: `${characteristic}${difficulty}.dat`,
});

describe('buildDifficultyMenu', () => {
  it('組內按標準難度序 Easy→ExpertPlus(不照輸入序)', () => {
    const groups = buildDifficultyMenu([
      ref('Standard', 'ExpertPlus'),
      ref('Standard', 'Easy'),
      ref('Standard', 'Hard'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.difficulties.map((d) => d.difficulty)).toEqual(['Easy', 'Hard', 'ExpertPlus']);
  });

  it('濾掉 Lightshow', () => {
    const groups = buildDifficultyMenu([ref('Standard', 'Expert'), ref('Lightshow', 'Easy')]);
    expect(groups.map((g) => g.characteristic)).toEqual(['Standard']);
  });

  it('多 characteristic 分組,Standard 優先', () => {
    const groups = buildDifficultyMenu([
      ref('OneSaber', 'Expert'),
      ref('Standard', 'Normal'),
    ]);
    expect(groups.map((g) => g.characteristic)).toEqual(['Standard', 'OneSaber']);
  });

  it('未知難度名排最後', () => {
    const groups = buildDifficultyMenu([ref('Standard', 'ExpertPlusPlus'), ref('Standard', 'Normal')]);
    expect(groups[0]!.difficulties.map((d) => d.difficulty)).toEqual(['Normal', 'ExpertPlusPlus']);
  });

  it('全 Lightshow → 空清單', () => {
    expect(buildDifficultyMenu([ref('Lightshow', 'Easy')])).toEqual([]);
  });
});

describe('noteStats', () => {
  it('v3:數 colorNotes、取最大 b', () => {
    const text = JSON.stringify({
      version: '3.2.0',
      colorNotes: [{ b: 1 }, { b: 4.5 }, { b: 2 }],
      bombNotes: [{ b: 9 }], // 炸彈另一陣列,不算入
    });
    expect(noteStats(text)).toEqual({ count: 3, lastBeat: 4.5 });
  });

  it('v2:數 _notes、濾炸彈(_type 3)、取最大 _time', () => {
    const text = JSON.stringify({
      _version: '2.0.0',
      _notes: [
        { _type: 0, _time: 1 },
        { _type: 1, _time: 3 },
        { _type: 3, _time: 8 }, // 炸彈,濾除
      ],
    });
    expect(noteStats(text)).toEqual({ count: 2, lastBeat: 3 });
  });

  it('壞 JSON / 無音符 → 全 0', () => {
    expect(noteStats('not json')).toEqual({ count: 0, lastBeat: 0 });
    expect(noteStats(JSON.stringify({ colorNotes: [] }))).toEqual({ count: 0, lastBeat: 0 });
    expect(noteStats(JSON.stringify({}))).toEqual({ count: 0, lastBeat: 0 });
  });
});
