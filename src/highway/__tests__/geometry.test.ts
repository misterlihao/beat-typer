// geometry 的測試:位置數學是純函式,直接斷言輸出,不涉及 THREE / DOM。
import { describe, expect, it } from 'vitest';
import { comboTier, COMBO_TIERS, KEY_LAYOUT, laneX, liftAt, PLANE_Z, rowY, zAt } from '../geometry.ts';

describe('KEY_LAYOUT', () => {
  it('家排從左到右欄 0..9、列=1(家)', () => {
    expect(KEY_LAYOUT.KeyA).toEqual({ col: 0, row: 1 });
    expect(KEY_LAYOUT.KeyF).toEqual({ col: 3, row: 1 });
    expect(KEY_LAYOUT.Semicolon).toEqual({ col: 9, row: 1 });
  });
  it('上排列=2、下排列=0', () => {
    expect(KEY_LAYOUT.KeyQ).toEqual({ col: 0, row: 2 });
    expect(KEY_LAYOUT.KeyZ).toEqual({ col: 0, row: 0 });
  });
  it('數字排列=3,從左到右欄 0..9', () => {
    expect(KEY_LAYOUT.Digit1).toEqual({ col: 0, row: 3 });
    expect(KEY_LAYOUT.Digit0).toEqual({ col: 9, row: 3 });
  });
});

describe('laneX / rowY', () => {
  it('置中欄(col 4.5 附近)x 接近 0,兩端對稱', () => {
    expect(laneX(0)).toBeCloseTo(-laneX(9), 5);
  });
  it('家排(row=1)y=0,上排(row=2)為正、下排(row=0)為負', () => {
    expect(rowY(1)).toBe(0);
    expect(rowY(2)).toBeGreaterThan(0);
    expect(rowY(0)).toBeLessThan(0);
  });
});

describe('liftAt', () => {
  it('判定平面(z=0)抬升為 0', () => {
    expect(liftAt(PLANE_Z)).toBe(0);
  });
  it('近端平直區間(深度 ≤ FLAT_FRAC)抬升為 0', () => {
    expect(liftAt(-5)).toBe(0); // 深度 5/40=0.125 < 0.35
  });
  it('遠端(z=FAR_Z)抬升為正、且比中段更高', () => {
    const mid = liftAt(-20);
    const far = liftAt(-40);
    expect(far).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
  });
});

describe('zAt', () => {
  it('p=0 為生成遠端、p=1 為判定平面', () => {
    expect(zAt(1)).toBe(PLANE_Z);
    expect(zAt(0)).toBeLessThan(PLANE_Z);
  });
  it('超出 [0,1] 會被夾住', () => {
    expect(zAt(2)).toBe(zAt(1));
    expect(zAt(-1)).toBe(zAt(0));
  });
});

describe('comboTier', () => {
  it('依門檻 0/20/50/100 落在對應階(索引越小階越高)', () => {
    expect(comboTier(0)).toBe(COMBO_TIERS.length - 1);
    expect(comboTier(19)).toBe(COMBO_TIERS.length - 1);
    expect(comboTier(20)).toBe(2);
    expect(comboTier(49)).toBe(2);
    expect(comboTier(50)).toBe(1);
    expect(comboTier(99)).toBe(1);
    expect(comboTier(100)).toBe(0);
  });
});
