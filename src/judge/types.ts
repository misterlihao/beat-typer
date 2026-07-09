// judge 層的核心資料形狀。純函式、可決定性,無 I/O、音訊、渲染。

/** 單顆音符的判定結果。 */
export type JudgeResult = 'perfect' | 'good' | 'miss';

/** 總評級。 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 一顆音符的判定。 */
export interface Judgment {
  readonly noteIndex: number;
  readonly result: JudgeResult;
  /** 命中時的時間差 press.t − (tSec + offset);miss 無。 */
  readonly deltaSec?: number;
}

/** 帶時戳的按鍵事件(t = 按下當下的 player.positionSec)。 */
export interface InputEvent {
  readonly t: number;
  readonly key: string; // KeyboardEvent.code
}

/** 一次按鍵的即時結果(即時回饋用)。 */
export type PressOutcome =
  | { readonly kind: 'perfect' | 'good'; readonly noteIndex: number; readonly deltaSec: number }
  | { readonly kind: 'miss'; readonly noteIndex: number } // 窗內敲錯鍵
  | { readonly kind: 'extra' }; // 附近無音符的多餘按鍵

/** judge 的結算摘要。 */
export interface JudgeSummary {
  readonly accuracy: number; // 0..1
  readonly maxCombo: number;
  readonly combo: number; // 當前 combo(nowSec 給定時反映到當下)
  readonly counts: { readonly perfect: number; readonly good: number; readonly miss: number };
  readonly extras: number; // 多餘按鍵數(僅顯示,不罰)
  readonly grade: Grade;
  readonly fullCombo: boolean; // 無 Miss
}

/** judge 的組態。窗寬與 offset(與高速公路共用)。 */
export interface JudgeConfig {
  readonly perfectSec: number;
  readonly goodSec: number;
  readonly offsetSec: number;
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  perfectSec: 0.045,
  goodSec: 0.09,
  offsetSec: 0,
};
