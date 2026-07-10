// BSR 下載的純函式驗收(issue 16):代號解析與下載網址挑選。
// fetch / BsrChartSource 為薄網路 I/O,不 mock、不測(以 playtest-highway 實跑真實代號驗)。
import { describe, expect, it } from 'vitest';
import { parseBsrCode, pickDownloadUrl } from '../bsr.ts';

describe('parseBsrCode', () => {
  it('純代號原樣(轉小寫)', () => {
    expect(parseBsrCode('5277c')).toBe('5277c');
    expect(parseBsrCode('2A29')).toBe('2a29');
  });

  it('去掉 "!bsr " 前綴(不分大小寫)', () => {
    expect(parseBsrCode('!bsr 5277c')).toBe('5277c');
    expect(parseBsrCode('!BSR 5277C')).toBe('5277c');
    expect(parseBsrCode('!bsr   5277c')).toBe('5277c'); // 多空白
  });

  it('從 BeatSaver URL 抽代號', () => {
    expect(parseBsrCode('https://beatsaver.com/maps/5277c')).toBe('5277c');
    expect(parseBsrCode('https://beatsaver.com/maps/5277c/somebody')).toBe('5277c');
    expect(parseBsrCode('beatsaver.com/maps/2A29')).toBe('2a29');
  });

  it('去頭尾空白', () => {
    expect(parseBsrCode('  5277c  ')).toBe('5277c');
  });

  it('無法解析回 null', () => {
    expect(parseBsrCode('')).toBeNull();
    expect(parseBsrCode('hello world')).toBeNull();
    expect(parseBsrCode('!bsr')).toBeNull(); // 只有前綴沒代號
    expect(parseBsrCode('xyz!')).toBeNull(); // 非 hex
    expect(parseBsrCode('https://example.com/foo')).toBeNull();
  });
});

describe('pickDownloadUrl', () => {
  it('取第一個 Published 版本的 downloadURL', () => {
    const map = {
      versions: [
        { state: 'Testplay', downloadURL: 'https://cdn/testplay.zip' },
        { state: 'Published', downloadURL: 'https://cdn/first-published.zip' },
        { state: 'Published', downloadURL: 'https://cdn/second-published.zip' },
      ],
    };
    expect(pickDownloadUrl(map)).toBe('https://cdn/first-published.zip');
  });

  it('只有一個 Published', () => {
    const map = { versions: [{ state: 'Published', downloadURL: 'https://cdn/only.zip' }] };
    expect(pickDownloadUrl(map)).toBe('https://cdn/only.zip');
  });

  it('無 Published 版本 → 報錯', () => {
    expect(() => pickDownloadUrl({ versions: [{ state: 'Testplay', downloadURL: 'https://cdn/t.zip' }] })).toThrow();
    expect(() => pickDownloadUrl({ versions: [] })).toThrow();
    expect(() => pickDownloadUrl({})).toThrow();
  });

  it('Published 但缺 downloadURL → 跳過,無其他可用則報錯', () => {
    const map = { versions: [{ state: 'Published' }] };
    expect(() => pickDownloadUrl(map)).toThrow();
  });
});
