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

/**
 * 帶時戳的按鍵事件(t = 事件當下的 player.positionSec)。
 * `up` 為放開(keyup);缺省/false = 按下(keydown)。長按尾部判定靠放開事件。
 */
export interface InputEvent {
  readonly t: number;
  readonly key: string; // KeyboardEvent.code
  readonly up?: boolean;
}

/** 一次按鍵(keydown)的即時結果(即時回饋用)。長按頭部命中亦回 perfect/good(noteIndex 指向該 hold)。 */
export type PressOutcome =
  | { readonly kind: 'perfect' | 'good'; readonly noteIndex: number; readonly deltaSec: number }
  | { readonly kind: 'miss'; readonly noteIndex: number } // 窗內敲錯鍵
  | { readonly kind: 'extra' }; // 附近無音符的多餘按鍵

/**
 * 一次放開(keyup)的即時結果。
 * `break` = 提早放開破壞長按(已判 Miss);`safe` = 撐過破壞點的放開(結果留待尾部鎖定);
 * `ignored` = 無對應 active hold 的放開(多餘放開,不罰)。
 */
export type ReleaseOutcome =
  | { readonly kind: 'break'; readonly noteIndex: number }
  | { readonly kind: 'safe'; readonly noteIndex: number }
  | { readonly kind: 'ignored' };

/** judge 的結算摘要。 */
export interface JudgeSummary {
  readonly accuracy: number; // 0..1
  readonly maxCombo: number;
  readonly combo: number; // 當前 combo(nowSec 給定時反映到當下)
  readonly counts: { readonly perfect: number; readonly good: number; readonly miss: number };
  readonly extras: number; // 多餘按鍵數(不罰;判定分類用,不對玩家顯示,見 CONTEXT)
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
