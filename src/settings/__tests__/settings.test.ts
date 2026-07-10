// 設定持久化的純函式驗收(issue 12):coerceSettings 的回退/夾範圍/原樣。
// localStorage 讀寫為薄 I/O,不 mock、不測(見 docs/issues/12)。
import { describe, expect, it } from 'vitest';
import { coerceSettings, SETTINGS_SPEC, type Settings } from '../settings.ts';

const DEFAULTS: Settings = {
  flightTime: SETTINGS_SPEC.flightTime.default,
  offsetSec: SETTINGS_SPEC.offsetSec.default,
  tickVolume: SETTINGS_SPEC.tickVolume.default,
};

describe('coerceSettings — 回退預設', () => {
  it('空物件 → 全預設', () => {
    expect(coerceSettings({})).toEqual(DEFAULTS);
  });

  it('缺欄位 → 該欄位回預設,其餘保留', () => {
    expect(coerceSettings({ flightTime: 2 })).toEqual({ ...DEFAULTS, flightTime: 2 });
  });

  it('非物件(壞 JSON parse 出來的 null / 字串 / 數字)→ 全預設', () => {
    expect(coerceSettings(null)).toEqual(DEFAULTS);
    expect(coerceSettings('garbage')).toEqual(DEFAULTS);
    expect(coerceSettings(42)).toEqual(DEFAULTS);
    expect(coerceSettings(undefined)).toEqual(DEFAULTS);
  });

  it('欄位非有限數(NaN / Infinity / 字串 / null)→ 回預設', () => {
    expect(coerceSettings({ flightTime: NaN, offsetSec: Infinity, tickVolume: '0.5' })).toEqual(DEFAULTS);
    expect(coerceSettings({ flightTime: null })).toEqual(DEFAULTS);
  });
});

describe('coerceSettings — 夾範圍', () => {
  it('超上限 → 夾回 max', () => {
    expect(coerceSettings({ flightTime: 99, offsetSec: 5, tickVolume: 3 })).toEqual({
      flightTime: SETTINGS_SPEC.flightTime.max,
      offsetSec: SETTINGS_SPEC.offsetSec.max,
      tickVolume: SETTINGS_SPEC.tickVolume.max,
    });
  });

  it('超下限 → 夾回 min', () => {
    expect(coerceSettings({ flightTime: -1, offsetSec: -5, tickVolume: -0.2 })).toEqual({
      flightTime: SETTINGS_SPEC.flightTime.min,
      offsetSec: SETTINGS_SPEC.offsetSec.min,
      tickVolume: SETTINGS_SPEC.tickVolume.min,
    });
  });

  it('邊界值原樣保留', () => {
    const edge: Settings = {
      flightTime: SETTINGS_SPEC.flightTime.max,
      offsetSec: SETTINGS_SPEC.offsetSec.min,
      tickVolume: SETTINGS_SPEC.tickVolume.min,
    };
    expect(coerceSettings(edge)).toEqual(edge);
  });
});

describe('coerceSettings — 合法值原樣', () => {
  it('區間內的值不動', () => {
    const valid: Settings = { flightTime: 1.5, offsetSec: -0.1, tickVolume: 0.6 };
    expect(coerceSettings(valid)).toEqual(valid);
  });

  it('忽略多餘欄位', () => {
    expect(coerceSettings({ ...DEFAULTS, bogus: 123 })).toEqual(DEFAULTS);
  });
});
