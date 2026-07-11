import { describe, expect, it } from 'vitest';
import { coerceRecentBsr, type RecentBsr } from '../recentBsr.ts';

// 只測純函式 coerceRecentBsr(容錯 / 去重 / 截斷);load/record 為薄 localStorage I/O,不測。

describe('coerceRecentBsr', () => {
  it('非陣列一律回空清單', () => {
    expect(coerceRecentBsr(null)).toEqual([]);
    expect(coerceRecentBsr(undefined)).toEqual([]);
    expect(coerceRecentBsr({})).toEqual([]);
    expect(coerceRecentBsr('nope')).toEqual([]);
  });

  it('合法項原樣保留', () => {
    const raw: RecentBsr[] = [
      { code: '5277c', songName: 'Song A' },
      { code: 'abc', songName: 'Song B' },
    ];
    expect(coerceRecentBsr(raw)).toEqual(raw);
  });

  it('丟棄壞項(缺 code / 非字串 code / 空字串 / null)', () => {
    const raw = [
      { code: 'ok', songName: 'Good' },
      { songName: '缺 code' },
      { code: 123, songName: '非字串 code' },
      { code: '', songName: '空字串' },
      null,
      'not an object',
    ];
    expect(coerceRecentBsr(raw)).toEqual([{ code: 'ok', songName: 'Good' }]);
  });

  it('歌名缺 / 非字串 / 空字串時退回 code', () => {
    const raw = [{ code: '5277c' }, { code: 'abc', songName: 42 }, { code: 'def', songName: '' }];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: '5277c', songName: '5277c' },
      { code: 'abc', songName: 'abc' },
      { code: 'def', songName: 'def' },
    ]);
  });

  it('以 code 去重,保留較前(較新)的一筆', () => {
    const raw = [
      { code: 'dup', songName: '新名' },
      { code: 'other', songName: 'X' },
      { code: 'dup', songName: '舊名' },
    ];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: 'dup', songName: '新名' },
      { code: 'other', songName: 'X' },
    ]);
  });

  it('截到上限 20 筆', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({ code: `c${i}`, songName: `S${i}` }));
    const out = coerceRecentBsr(raw);
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({ code: 'c0', songName: 'S0' });
    expect(out[19]).toEqual({ code: 'c19', songName: 'S19' });
  });
});
