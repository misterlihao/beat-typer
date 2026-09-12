// 成績持久化純函式驗收(issue 18):songKey 可決定性、鍵群係數/調整後準確率、
// applyRun 單調刷新(含 combo/FC 只全鍵解鎖)、coerceScores 容錯。localStorage I/O 不測(見 docs/issues/18)。
import { describe, expect, it } from 'vitest';
import {
  adjustedAccuracy,
  applyRun,
  coefficientFor,
  coerceScores,
  songKey,
  type ScoreRecord,
} from '../scores.ts';

describe('songKey — 難度檔雜湊身分', () => {
  it('同文字永得同鍵(可決定性)', () => {
    expect(songKey('{"notes":[1,2,3]}')).toBe(songKey('{"notes":[1,2,3]}'));
  });
  it('不同文字得不同鍵', () => {
    expect(songKey('chart-A')).not.toBe(songKey('chart-B'));
    // 單字元差異也要區分
    expect(songKey('{"v":1}')).not.toBe(songKey('{"v":2}'));
  });
});

describe('coefficientFor / adjustedAccuracy — 鍵群係數', () => {
  it('全鍵係數 = 1(調整後 = 原始)', () => {
    expect(coefficientFor('all')).toBe(1);
    expect(adjustedAccuracy(0.9, 'all')).toBe(0.9);
  });
  it('單排鍵群折算 = 0.625(5/20 鍵)——四排池大小相同,故係數相同', () => {
    for (const g of ['home', 'top', 'bottom', 'number'] as const) {
      expect(coefficientFor(g)).toBeCloseTo(0.625, 4);
    }
  });
  it('係數:全鍵 > 任一單排', () => {
    expect(coefficientFor('all')).toBeGreaterThan(coefficientFor('home'));
  });
});

describe('applyRun — 併入紀錄', () => {
  it('首玩(prev undefined):以本場建紀錄,improved=true', () => {
    const { record, improved } = applyRun(undefined, { rawAccuracy: 0.5, keyGroup: 'all', maxCombo: 8, fullCombo: true });
    expect(record).toEqual({ bestRawAccuracy: 0.5, bestKeyGroup: 'all', bestMaxCombo: 8, everFullCombo: true });
    expect(improved).toBe(true);
  });

  it('調整後準確率更高 → 換原始+鍵群,improved=true', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 0.7, bestKeyGroup: 'all', bestMaxCombo: 10, everFullCombo: false };
    const { record, improved } = applyRun(prev, { rawAccuracy: 0.9, keyGroup: 'all', maxCombo: 5, fullCombo: false });
    expect(record.bestRawAccuracy).toBe(0.9);
    expect(record.bestKeyGroup).toBe('all');
    expect(improved).toBe(true);
  });

  it('調整後不較高 → 保留舊最佳,improved=false;combo 仍取 max', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 0.9, bestKeyGroup: 'all', bestMaxCombo: 10, everFullCombo: false };
    const { record, improved } = applyRun(prev, { rawAccuracy: 0.5, keyGroup: 'all', maxCombo: 3, fullCombo: false });
    expect(record.bestRawAccuracy).toBe(0.9);
    expect(record.bestMaxCombo).toBe(10);
    expect(improved).toBe(false);
  });

  it('跨鍵群:家排 100%(調整 0.625)輸給全鍵 80%(調整 0.80)', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 1.0, bestKeyGroup: 'home', bestMaxCombo: 0, everFullCombo: false };
    const { record, improved } = applyRun(prev, { rawAccuracy: 0.8, keyGroup: 'all', maxCombo: 20, fullCombo: false });
    expect(record.bestRawAccuracy).toBe(0.8);
    expect(record.bestKeyGroup).toBe('all');
    expect(improved).toBe(true);
  });

  it('combo 與 FC 只在全鍵解鎖:非全鍵的高 combo/FC 不計入', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 0.9, bestKeyGroup: 'all', bestMaxCombo: 10, everFullCombo: false };
    const { record, improved } = applyRun(prev, { rawAccuracy: 0.95, keyGroup: 'home', maxCombo: 50, fullCombo: true });
    expect(record.bestMaxCombo).toBe(10); // 家排 combo 50 不解鎖
    expect(record.everFullCombo).toBe(false); // 家排 FC 不解鎖
    // 家排 0.95 調整後 0.594 < 0.9 → 準確率也沒刷新
    expect(improved).toBe(false);
  });

  it('全鍵下 combo 破紀錄即 improved(即使準確率沒進步)', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 1.0, bestKeyGroup: 'all', bestMaxCombo: 10, everFullCombo: true };
    const { record, improved } = applyRun(prev, { rawAccuracy: 1.0, keyGroup: 'all', maxCombo: 20, fullCombo: true });
    expect(record.bestMaxCombo).toBe(20);
    expect(improved).toBe(true);
  });

  it('全鍵首次 FC 即 improved', () => {
    const prev: ScoreRecord = { bestRawAccuracy: 1.0, bestKeyGroup: 'all', bestMaxCombo: 20, everFullCombo: false };
    const { record, improved } = applyRun(prev, { rawAccuracy: 0.5, keyGroup: 'all', maxCombo: 5, fullCombo: true });
    expect(record.everFullCombo).toBe(true);
    expect(improved).toBe(true);
  });
});

describe('coerceScores — 容錯回退', () => {
  const empty = { version: 2, records: {} };
  it('非物件 / null → 空庫', () => {
    expect(coerceScores(null)).toEqual(empty);
    expect(coerceScores('garbage')).toEqual(empty);
    expect(coerceScores(42)).toEqual(empty);
  });
  it('版本不符 → 空庫', () => {
    expect(coerceScores({ version: 999, records: { a: {} } })).toEqual(empty);
  });
  it('v1 舊庫(鍵群改分排前)整庫作廢', () => {
    const v1 = { version: 1, records: { a: { bestRawAccuracy: 0.9, bestKeyGroup: 'all', bestMaxCombo: 12, everFullCombo: true } } };
    expect(coerceScores(v1)).toEqual(empty);
  });
  it('records 非物件 → 空庫', () => {
    expect(coerceScores({ version: 2, records: null })).toEqual(empty);
  });
  it('丟棄壞紀錄、保留好的', () => {
    const good: ScoreRecord = { bestRawAccuracy: 0.9, bestKeyGroup: 'all', bestMaxCombo: 12, everFullCombo: true };
    const out = coerceScores({
      version: 2,
      records: {
        ok: good,
        badAcc: { bestRawAccuracy: 'x', bestKeyGroup: 'all', bestMaxCombo: 1, everFullCombo: false },
        badGroup: { bestRawAccuracy: 0.5, bestKeyGroup: 'bogus', bestMaxCombo: 1, everFullCombo: false },
        badFC: { bestRawAccuracy: 0.5, bestKeyGroup: 'all', bestMaxCombo: 1, everFullCombo: 'yes' },
      },
    });
    expect(out.records).toEqual({ ok: good });
  });
  it('準確率夾到 0..1、combo 取整非負', () => {
    const out = coerceScores({
      version: 2,
      records: { a: { bestRawAccuracy: 1.5, bestKeyGroup: 'home', bestMaxCombo: 3.9, everFullCombo: false } },
    });
    expect(out.records.a).toEqual({ bestRawAccuracy: 1, bestKeyGroup: 'home', bestMaxCombo: 3, everFullCombo: false });
  });
});
