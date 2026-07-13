// 薄設定層:跨譜、跨場的全域玩家偏好持久化到 localStorage(見 docs/issues/12)。
// 數值偏好(飛行時間 / offset / 按鍵音量)+ 列舉偏好(訓練鍵群,issue 15)。
// 純函式 coerceSettings 可測;localStorage 讀寫為薄 I/O,不 mock、不測。
// 只從 compile 取 KeyGroup「詞彙」(純型別/常數,非接縫函式);仍不 import compileChart / judge。
import { KEY_GROUPS, type KeyGroup } from '../compile/types.ts';

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
  // 燈光強度(issue 24):0=關;預設保守中低值(周邊+淡色已保護讀字,滑桿是逃生口)。
  lightIntensity: { default: 0.55, min: 0, max: 1, step: 0.05 },
} as const;

export type SettingKey = keyof typeof SETTINGS_SPEC;

/** 列舉設定的單一真相:合法值集 + 預設。keyGroup 的合法值即 compile 的 KEY_GROUPS。 */
export const KEY_GROUP_DEFAULT: KeyGroup = 'all';

export type Settings = { [K in SettingKey]: number } & { keyGroup: KeyGroup };

const KEYS = Object.keys(SETTINGS_SPEC) as SettingKey[];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * 把任意來源(壞 JSON 的 parse 結果、被手動竄改的值)強制成合法 Settings:
 * 數值:缺 / 非有限 → 回退預設,超區間 → 夾回 [min,max];列舉:不在合法值集 → 回退預設。純函式,可測。
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
  out.keyGroup = KEY_GROUPS.includes(obj.keyGroup as KeyGroup) ? (obj.keyGroup as KeyGroup) : KEY_GROUP_DEFAULT;
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
