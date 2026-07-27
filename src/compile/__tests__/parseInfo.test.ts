// parseInfo:歌名解析(issue 04 新增 songName 欄位)+ 難度身分比對規則(findDifficulty)。
import { describe, expect, it } from 'vitest';
import { findDifficulty, parseInfo } from '../parseInfo.ts';

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

// 難度身分 = 特性 + 難度名。身分規則的家在這裡;下游 compileChart / compileLightShow 只驗「有沒有漏接」。
// 撞名是真實案例:同一張圖的 Lightshow 與 Standard 都可有 ExpertPlus(見 GitHub issue #4)。
describe('parseInfo findDifficulty — 難度身分比對', () => {
  const info = parseInfo(
    JSON.stringify({
      ...base,
      _difficultyBeatmapSets: [
        {
          _beatmapCharacteristicName: 'Lightshow',
          _difficultyBeatmaps: [{ _difficulty: 'ExpertPlus', _beatmapFilename: 'ep-lightshow.dat' }],
        },
        {
          _beatmapCharacteristicName: 'Standard',
          _difficultyBeatmaps: [{ _difficulty: 'ExpertPlus', _beatmapFilename: 'ep-standard.dat' }],
        },
      ],
    }),
  );

  it('同名難度散在多個特性時依特性選對那一筆(不受清單順序影響)', () => {
    // Standard 排在後面,照樣拿到自己的檔(只比難度名會拿到排前面的 Lightshow)。
    expect(
      findDifficulty(info.difficulties, { characteristic: 'Standard', difficulty: 'ExpertPlus' })?.filename,
    ).toBe('ep-standard.dat');
    // 反面:Lightshow 用自己的身分也拿到自己的檔。
    expect(
      findDifficulty(info.difficulties, { characteristic: 'Lightshow', difficulty: 'ExpertPlus' })?.filename,
    ).toBe('ep-lightshow.dat');
  });

  it('難度名對但特性不存在 → undefined(不退回同名的其他特性)', () => {
    expect(
      findDifficulty(info.difficulties, { characteristic: 'OneSaber', difficulty: 'ExpertPlus' }),
    ).toBeUndefined();
  });

  it('精確比對:大小寫不寬容(檔名層級的寬容在 SongHandle.readFile,不在此)', () => {
    expect(
      findDifficulty(info.difficulties, { characteristic: 'standard', difficulty: 'ExpertPlus' }),
    ).toBeUndefined();
    expect(
      findDifficulty(info.difficulties, { characteristic: 'Standard', difficulty: 'expertplus' }),
    ).toBeUndefined();
  });
});
