// 資料匯出 / 匯入純函式驗收(issue 26):buildBackup 信封、parseBackup 認檔 + salvage、
// mergeBackup 覆蓋 / 合併語義。下載 / 選檔 / 寫回為薄 localStorage I/O,不測。
import { describe, expect, it } from 'vitest';
import { buildBackup, mergeBackup, parseBackup, type BackupData } from '../backup.ts';
import type { ScoreRecord } from '../../scores/scores.ts';
import type { Settings } from '../../settings/settings.ts';
import type { RecentBsr } from '../../loader/recentBsr.ts';

const SETTINGS: Settings = {
  flightTime: 1.75,
  offsetSec: 0,
  tickVolume: 0.3,
  lightIntensity: 0.55,
  keyGroup: 'all',
};

const rec = (over: Partial<ScoreRecord> = {}): ScoreRecord => ({
  bestRawAccuracy: 0.9,
  bestKeyGroup: 'all',
  bestMaxCombo: 10,
  everFullCombo: false,
  ...over,
});

const data = (over: Partial<BackupData> = {}): BackupData => ({
  settings: SETTINGS,
  scores: { version: 1, records: {} },
  recentBsr: [],
  ...over,
});

describe('buildBackup — 信封', () => {
  it('帶 app/kind/version/exportedAt/data', () => {
    const b = buildBackup(data(), '2026-07-14T00:00:00.000Z');
    expect(b.app).toBe('beat-typer');
    expect(b.kind).toBe('backup');
    expect(b.version).toBe(1);
    expect(b.exportedAt).toBe('2026-07-14T00:00:00.000Z');
    expect(b.data.settings.keyGroup).toBe('all');
  });

  it('round-trip:build 後 parse 回得同資料', () => {
    const b = buildBackup(data({ recentBsr: [{ code: 'abc', songName: 'X', pinned: true }] }), 'now');
    const parsed = parseBackup(JSON.parse(JSON.stringify(b)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.recentBsr).toEqual([{ code: 'abc', songName: 'X', pinned: true }]);
  });
});

describe('parseBackup — 認檔 + salvage', () => {
  it('非物件 / null → 拒絕', () => {
    expect(parseBackup(null).ok).toBe(false);
    expect(parseBackup('garbage').ok).toBe(false);
    expect(parseBackup(42).ok).toBe(false);
  });

  it('缺 app / app 不符 → 拒絕(外來檔)', () => {
    expect(parseBackup({ version: 1, data: {} }).ok).toBe(false);
    expect(parseBackup({ app: 'other-app', version: 1, data: {} }).ok).toBe(false);
  });

  it('版本不認 → 拒絕', () => {
    expect(parseBackup({ app: 'beat-typer', version: 999, data: {} }).ok).toBe(false);
  });

  it('合法信封但 data 缺 → 三 store 各自回預設(coerce 補齊)', () => {
    const r = parseBackup({ app: 'beat-typer', kind: 'backup', version: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.settings.keyGroup).toBe('all');
      expect(r.data.scores).toEqual({ version: 1, records: {} });
      expect(r.data.recentBsr).toEqual([]);
    }
  });

  it('部分壞紀錄 salvage:好的成績留、壞的丟', () => {
    const r = parseBackup({
      app: 'beat-typer',
      version: 1,
      data: {
        scores: {
          version: 1,
          records: {
            ok: rec({ bestRawAccuracy: 0.8 }),
            bad: { bestRawAccuracy: 'x', bestKeyGroup: 'all', bestMaxCombo: 1, everFullCombo: false },
          },
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data.scores.records)).toEqual(['ok']);
  });
});

describe('mergeBackup — replace(覆蓋)', () => {
  it('三 store 全取 incoming(含設定)', () => {
    const current = data({
      settings: { ...SETTINGS, flightTime: 3, keyGroup: 'home' },
      scores: { version: 1, records: { a: rec() } },
    });
    const incoming = data({
      settings: { ...SETTINGS, flightTime: 0.8 },
      scores: { version: 1, records: { b: rec({ bestRawAccuracy: 0.5 }) } },
    });
    const out = mergeBackup(current, incoming, 'replace');
    expect(out).toEqual(incoming);
    expect(out.settings.flightTime).toBe(0.8);
    expect(Object.keys(out.scores.records)).toEqual(['b']);
  });
});

describe('mergeBackup — merge(合併)', () => {
  it('設定不碰 B(保留 current)', () => {
    const current = data({ settings: { ...SETTINGS, flightTime: 2.5, keyGroup: 'home' } });
    const incoming = data({ settings: { ...SETTINGS, flightTime: 0.8, keyGroup: 'all' } });
    const out = mergeBackup(current, incoming, 'merge');
    expect(out.settings.flightTime).toBe(2.5);
    expect(out.settings.keyGroup).toBe('home');
  });

  it('成績:單邊有的直接收,兩邊都有的取較佳(調整後準確率)', () => {
    const current = data({
      scores: { version: 1, records: { onlyB: rec({ bestRawAccuracy: 0.7 }), both: rec({ bestRawAccuracy: 0.6 }) } },
    });
    const incoming = data({
      scores: { version: 1, records: { onlyA: rec({ bestRawAccuracy: 0.5 }), both: rec({ bestRawAccuracy: 0.95 }) } },
    });
    const out = mergeBackup(current, incoming, 'merge');
    expect(Object.keys(out.scores.records).sort()).toEqual(['both', 'onlyA', 'onlyB']);
    expect(out.scores.records.both.bestRawAccuracy).toBe(0.95); // incoming 較高
    expect(out.scores.records.onlyA.bestRawAccuracy).toBe(0.5);
    expect(out.scores.records.onlyB.bestRawAccuracy).toBe(0.7);
  });

  it('成績跨鍵群:全鍵 80%(調整 0.80)勝家排 100%(調整 0.667);combo/FC 取 max/OR', () => {
    const current = data({
      scores: { version: 1, records: { s: rec({ bestRawAccuracy: 1.0, bestKeyGroup: 'home', bestMaxCombo: 30, everFullCombo: true }) } },
    });
    const incoming = data({
      scores: { version: 1, records: { s: rec({ bestRawAccuracy: 0.8, bestKeyGroup: 'all', bestMaxCombo: 12, everFullCombo: false }) } },
    });
    const out = mergeBackup(current, incoming, 'merge').scores.records.s;
    expect(out.bestRawAccuracy).toBe(0.8); // 調整後較高者的 raw
    expect(out.bestKeyGroup).toBe('all');
    expect(out.bestMaxCombo).toBe(30); // 兩邊 max
    expect(out.everFullCombo).toBe(true); // OR
  });

  it('最近清單:聯集去重、任一邊釘選即保留、current 排前面', () => {
    const current: RecentBsr[] = [
      { code: 'b1', songName: 'B-one', pinned: false },
      { code: 'shared', songName: 'B-name', pinned: false },
    ];
    const incoming: RecentBsr[] = [
      { code: 'shared', songName: 'A-name', pinned: true }, // 釘選衝突 → 保留釘選,歌名留 current
      { code: 'a1', songName: 'A-one', pinned: false },
    ];
    const out = mergeBackup(data({ recentBsr: current }), data({ recentBsr: incoming }), 'merge').recentBsr;
    const shared = out.find((r) => r.code === 'shared')!;
    expect(shared.pinned).toBe(true); // 任一邊釘選 → 釘選
    expect(shared.songName).toBe('B-name'); // 歌名留 current
    expect(out.map((r) => r.code).sort()).toEqual(['a1', 'b1', 'shared']);
    // 釘選項置頂(coerceRecentBsr 穩定分割)
    expect(out[0].code).toBe('shared');
  });
});
