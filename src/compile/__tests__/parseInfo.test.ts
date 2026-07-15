// parseInfo 的歌名解析(issue 04 新增 songName 欄位)。
import { describe, expect, it } from 'vitest';
import { parseInfo } from '../parseInfo.ts';

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
