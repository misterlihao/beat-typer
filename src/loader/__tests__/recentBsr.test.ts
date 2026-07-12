import { describe, expect, it } from 'vitest';
import { coerceRecentBsr, type RecentBsr } from '../recentBsr.ts';

// 只測純函式 coerceRecentBsr(容錯 / 去重 / 釘選不變式 / 截斷);load/record/toggle 為薄 localStorage I/O,不測。

describe('coerceRecentBsr', () => {
  it('非陣列一律回空清單', () => {
    expect(coerceRecentBsr(null)).toEqual([]);
    expect(coerceRecentBsr(undefined)).toEqual([]);
    expect(coerceRecentBsr({})).toEqual([]);
    expect(coerceRecentBsr('nope')).toEqual([]);
  });

  it('合法項原樣保留', () => {
    const raw: RecentBsr[] = [
      { code: '5277c', songName: 'Song A', pinned: false },
      { code: 'abc', songName: 'Song B', pinned: false },
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
    expect(coerceRecentBsr(raw)).toEqual([{ code: 'ok', songName: 'Good', pinned: false }]);
  });

  it('歌名缺 / 非字串 / 空字串時退回 code', () => {
    const raw = [{ code: '5277c' }, { code: 'abc', songName: 42 }, { code: 'def', songName: '' }];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: '5277c', songName: '5277c', pinned: false },
      { code: 'abc', songName: 'abc', pinned: false },
      { code: 'def', songName: 'def', pinned: false },
    ]);
  });

  it('pinned 非 true 一律當 false(舊存檔缺此欄 → 未釘選)', () => {
    const raw = [
      { code: 'a', songName: 'A' }, // 舊格式,無 pinned 欄
      { code: 'b', songName: 'B', pinned: 'yes' }, // 非布林
      { code: 'c', songName: 'C', pinned: true },
    ];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: 'c', songName: 'C', pinned: true },
      { code: 'a', songName: 'A', pinned: false },
      { code: 'b', songName: 'B', pinned: false },
    ]);
  });

  it('以 code 去重,保留較前(較新)的一筆', () => {
    const raw = [
      { code: 'dup', songName: '新名', pinned: false },
      { code: 'other', songName: 'X', pinned: false },
      { code: 'dup', songName: '舊名', pinned: false },
    ];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: 'dup', songName: '新名', pinned: false },
      { code: 'other', songName: 'X', pinned: false },
    ]);
  });

  it('釘選置前:所有釘選項目排在未釘選之前,兩群各自維持相對序', () => {
    const raw = [
      { code: 'u1', songName: 'U1', pinned: false },
      { code: 'p1', songName: 'P1', pinned: true },
      { code: 'u2', songName: 'U2', pinned: false },
      { code: 'p2', songName: 'P2', pinned: true },
    ];
    expect(coerceRecentBsr(raw)).toEqual([
      { code: 'p1', songName: 'P1', pinned: true },
      { code: 'p2', songName: 'P2', pinned: true },
      { code: 'u1', songName: 'U1', pinned: false },
      { code: 'u2', songName: 'U2', pinned: false },
    ]);
  });

  it('截到上限 30 筆:從尾端截,先砍最舊的未釘選', () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({
      code: `c${i}`,
      songName: `S${i}`,
      pinned: false,
    }));
    const out = coerceRecentBsr(raw);
    expect(out).toHaveLength(30);
    expect(out[0]).toEqual({ code: 'c0', songName: 'S0', pinned: false });
    expect(out[29]).toEqual({ code: 'c29', songName: 'S29', pinned: false });
  });

  it('截斷不淘汰釘選項目:釘選在前,超量時只砍未釘選尾端', () => {
    const raw = [
      { code: 'pinned-old', songName: '釘選', pinned: true },
      ...Array.from({ length: 40 }, (_, i) => ({ code: `c${i}`, songName: `S${i}`, pinned: false })),
    ];
    const out = coerceRecentBsr(raw);
    expect(out).toHaveLength(30);
    expect(out[0]).toEqual({ code: 'pinned-old', songName: '釘選', pinned: true });
    expect(out.some((r) => r.code === 'pinned-old')).toBe(true);
  });
});
