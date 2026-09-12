// 高速公路的位置/幾何純函式(唯一真實來源):鍵盤版面 → 道/列、遠→近飛行走廊、combo 分級。
// 純數學,無 THREE / DOM 依賴,可直接單元測試。見 docs/adr/0014。

export interface KeyLayout {
  readonly col: number; // 欄 0..9,由左到右
  readonly row: number; // 列 0=下 1=家 2=上
}

// ── 鍵盤版面:實體按鍵碼 → (欄, 列)。唯一的幾何真實來源。 ──
export const KEY_LAYOUT: Readonly<Record<string, KeyLayout>> = buildLayout();
function buildLayout(): Record<string, KeyLayout> {
  const rows: [row: number, codes: string[]][] = [
    [2, ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']],
    [1, ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']],
    [0, ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']],
  ];
  const out: Record<string, KeyLayout> = {};
  for (const [row, codes] of rows) codes.forEach((code, col) => (out[code] = { col, row }));
  return out;
}

// ── 幾何常數 ──
export const LANE_SPACING = 1.1;
export const ROW_SPACING = 1.0;
export const FAR_Z = -40; // 音符生成的遠端(在霧內,一出生即清楚可見;見 grilling)
export const PLANE_Z = 0; // 判定平面
export const NOTE_SIZE = 0.72;
export const COLS = 10;
export const ROWS = 3;

export const laneX = (col: number): number => (col - (COLS - 1) / 2) * LANE_SPACING;
export const rowY = (row: number): number => (row - 1) * ROW_SPACING;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// ── 向上彎曲的飛行走廊(去除近/遠螢幕重疊,見 grilling)。 ──
// 抬升量只依「深度」加在 Y 上:判定平面(z=0)抬升=0(保留鍵盤空間對應),遠端才彎。
// ease-in:近端 FLAT_FRAC 比例保持平直讓判定進進手感自然;之後二次曲線加速上抬拉開預覽。
const FLAT_FRAC = 0.35; // 近端保持平直的深度比例
const LIFT_MAX = 5.5; // 遠端最大抬升(世界單位;實跑微調)
export const liftAt = (z: number): number => {
  const d = clamp((PLANE_Z - z) / (PLANE_Z - FAR_Z), 0, 1); // 0=平面 .. 1=遠端
  if (d <= FLAT_FRAC) return 0;
  const t = (d - FLAT_FRAC) / (1 - FLAT_FRAC);
  return LIFT_MAX * t * t;
};
export const HOLD_SEG = 16; // hold body 沿曲線的分段數(分段貼合)

// ── 音符飛行進度(0=生成、1=抵達判定平面,夾在此範圍外)→ 世界 Z。 ──
const DIST_Z = PLANE_Z - FAR_Z;
export const zAt = (p: number): number => FAR_Z + clamp(p, 0, 1) * DIST_Z;

// combo 多階段:門檻 20/50/100 換色,<20 為白(combo≥2 才顯示)。跨階瞬間數字 pop 放大。
export const COMBO_TIERS: readonly { min: number; color: string }[] = [
  { min: 100, color: '#ffd23f' }, // 金(沿用判定金色系)
  { min: 50, color: '#b06ffb' }, // 紫
  { min: 20, color: '#5ad1c4' }, // 青藍
  { min: 0, color: '#eef1f7' }, // 白
];
export const comboTier = (combo: number): number => COMBO_TIERS.findIndex((t) => combo >= t.min);
