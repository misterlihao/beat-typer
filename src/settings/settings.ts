// 薄設定層:三個玩家偏好/校準(飛行時間 / offset / 按鍵音量)持久化到 localStorage。
// 皆為跨譜、跨場的全域偏好,非單譜屬性(見 docs/issues/12)。
// 純函式 coerceSettings 可測;localStorage 讀寫為薄 I/O,不 mock、不測。
// 不 import compileChart / judge——設定層與純函式接縫完全解耦。

const STORAGE_KEY = 'beat-typer:settings';

/**
 * 每個設定的單一真相:預設值 + 合法區間 + 滑桿步進。
 * highway 的滑桿 min/max/step/初值全據此生成;夾範圍的界線也用同一份,消除漂移。
 */
export const SETTINGS_SPEC = {
  flightTime: { default: 1.75, min: 0.8, max: 3, step: 0.05 },
  offsetSec: { default: 0, min: -0.3, max: 0.3, step: 0.005 },
  // 預設 tick 峰值 ~0.3;最大 100% = 峰值 1.0。
  tickVolume: { default: 0.3, min: 0, max: 1, step: 0.05 },
} as const;

export type SettingKey = keyof typeof SETTINGS_SPEC;
export type Settings = { [K in SettingKey]: number };

const KEYS = Object.keys(SETTINGS_SPEC) as SettingKey[];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * 把任意來源(壞 JSON 的 parse 結果、被手動竄改的值)強制成合法 Settings:
 * 缺欄位 / 非有限數 → 回退預設;超出區間 → 夾回 [min, max]。純函式,可測。
 */
export function coerceSettings(raw: unknown): Settings {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = {} as Settings;
  for (const key of KEYS) {
    const spec = SETTINGS_SPEC[key];
    const val = obj[key];
    out[key] =
      typeof val === 'number' && Number.isFinite(val) ? clamp(val, spec.min, spec.max) : spec.default;
  }
  return out;
}

/** 讀持久設定;localStorage 不可用 / 空 / 壞 JSON 一律靜默回退預設(coerceSettings 補齊)。 */
export function loadSettings(): Settings {
  let raw: unknown = {};
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text !== null) raw = JSON.parse(text);
  } catch {
    // localStorage 不可用(隱私模式 / 停用)或 JSON 壞掉 → 用預設
  }
  return coerceSettings(raw);
}

/** 合併部分設定並寫回單一 JSON blob;寫入失敗(配額 / 停用)靜默略過,不中斷遊戲。 */
export function patchSettings(partial: Partial<Settings>): void {
  const next = coerceSettings({ ...loadSettings(), ...partial });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 寫入失敗不該影響遊玩
  }
}
