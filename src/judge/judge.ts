// 次測試接縫:把 TypingChart + 帶時戳按鍵事件 → 判定 + summary。純函式、可決定性。
//
// 架構:Judger 是共用的「增量判定引擎」——即時路徑(高速公路)每次 keydown 呼叫 press()、
// 每幀呼叫 expiry();批次 judge() 對事件依序 fold press() 再收尾 expiry()。兩條路徑跑同一組原語,
// 邏輯單一真相來源。見 issue 07 grilling 決策。
import type { TypingChart } from '../compile/types.ts';
import type {
  Grade,
  InputEvent,
  Judgment,
  JudgeConfig,
  JudgeSummary,
  PressOutcome,
  ReleaseOutcome,
} from './types.ts';

const WEIGHT: Record<'perfect' | 'good', number> = { perfect: 1, good: 0.5 };
const EPS = 1e-9; // 浮點容差,讓窗邊界(如 |Δ| 恰為 goodSec)穩定命中

function gradeFor(accuracy: number): Grade {
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.85) return 'A';
  if (accuracy >= 0.7) return 'B';
  if (accuracy >= 0.5) return 'C';
  return 'D';
}

/**
 * 增量判定引擎。持有可變狀態,但無 I/O、對相同輸入序列可決定。
 * config 以參考持有:offset 可在遊玩中被滑桿更新(只影響後續配對,不回溯已判音符)。
 */
export class Judger {
  private readonly results: (Judgment | null)[];
  private combo = 0;
  private maxCombo = 0;
  private extras = 0;
  /**
   * 持續中的長按:頭部已命中、尚未定案。`results[i]` 維持 null(讓渲染續顯長條),
   * 直到 expiry 在尾部鎖定或 release 提早破壞才寫入。見 docs/adr/0010。
   */
  private readonly activeHolds = new Map<
    number,
    { result: 'perfect' | 'good'; deltaSec: number; released: boolean }
  >();

  constructor(
    private readonly chart: TypingChart,
    private readonly config: JudgeConfig,
  ) {
    this.results = new Array<Judgment | null>(chart.length).fill(null);
  }

  private targetTime(i: number): number {
    return this.chart[i]!.tSec + this.config.offsetSec;
  }

  /** 長按尾部時間(holdEndSec + offset)。 */
  private tailTime(i: number): number {
    return this.chart[i]!.holdEndSec! + this.config.offsetSec;
  }

  /** 長按破壞點:早於此放開即沒撐住。= 尾部 − goodSec。 */
  private breakPoint(i: number): number {
    return this.tailTime(i) - this.config.goodSec;
  }

  private bumpCombo(): void {
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  }

  private resolve(i: number, result: 'perfect' | 'good' | 'miss', deltaSec?: number): void {
    this.results[i] = { noteIndex: i, result, ...(deltaSec !== undefined ? { deltaSec } : {}) };
    if (result === 'miss') {
      this.combo = 0;
    } else {
      this.bumpCombo();
    }
  }

  /**
   * 把「窗已關閉(nowSec 嚴格超過 deadline)仍未判定」的音符補判 Miss。回傳這批 miss 的 noteIndex。
   * 用嚴格 `>`(含 EPS)以免恰在 deadline 的按下被搶先判 miss——那一刻仍是最後可命中的窗邊界。
   */
  expiry(nowSec: number): number[] {
    const { goodSec } = this.config;
    // 先鎖定撐過尾部的長按(頭部結果定案;combo 已於頭部計入,不變)。
    for (const [i, h] of this.activeHolds) {
      if (nowSec >= this.tailTime(i) - EPS) {
        this.results[i] = { noteIndex: i, result: h.result, deltaSec: h.deltaSec };
        this.activeHolds.delete(i);
      }
    }
    const missed: number[] = [];
    for (let i = 0; i < this.chart.length; i++) {
      if (this.results[i]) continue;
      if (this.activeHolds.has(i)) continue; // 持續中的長按:不判頭部 Miss
      if (nowSec > this.targetTime(i) + goodSec + EPS) {
        this.resolve(i, 'miss');
        missed.push(i);
      }
    }
    return missed;
  }

  /** 處理一次按下。先自我 expiry 到 event.t,再對窗內未判定音符配對。 */
  press(event: InputEvent): PressOutcome {
    this.expiry(event.t);
    const { perfectSec, goodSec } = this.config;

    // 候選 = 窗內、未判定的音符。
    let matchIdx = -1;
    let matchAbs = Infinity;
    let nearestIdx = -1;
    let nearestAbs = Infinity;
    for (let i = 0; i < this.chart.length; i++) {
      if (this.results[i]) continue;
      if (this.activeHolds.has(i)) continue; // 持續中的長按已被認領,不再被其他按下配對
      const delta = event.t - this.targetTime(i);
      const abs = Math.abs(delta);
      if (abs > goodSec + EPS) continue; // 不在窗內
      if (abs < nearestAbs) {
        nearestAbs = abs;
        nearestIdx = i;
      }
      if (this.chart[i]!.key === event.key && abs < matchAbs) {
        matchAbs = abs;
        matchIdx = i;
      }
    }

    if (nearestIdx === -1) {
      this.extras += 1; // 附近無音符 → 多餘按鍵,不罰、不斷 combo
      return { kind: 'extra' };
    }
    if (matchIdx !== -1) {
      const delta = event.t - this.targetTime(matchIdx);
      const result = Math.abs(delta) <= perfectSec + EPS ? 'perfect' : 'good';
      if (this.chart[matchIdx]!.kind === 'hold') {
        // 長按頭部命中:進「持續中」,當場 +combo,但不寫 results[i](尾部才定案)。
        this.activeHolds.set(matchIdx, { result, deltaSec: delta, released: false });
        this.bumpCombo();
        return { kind: result, noteIndex: matchIdx, deltaSec: delta };
      }
      this.resolve(matchIdx, result, delta);
      return { kind: result, noteIndex: matchIdx, deltaSec: delta };
    }
    // 窗內有目標卻敲錯鍵 → 最近的那顆 Miss + 斷 combo
    this.resolve(nearestIdx, 'miss');
    return { kind: 'miss', noteIndex: nearestIdx };
  }

  /**
   * 處理一次放開(keyup)。先自我 expiry 到 event.t(可能先鎖定/補判),
   * 再找 key 相符、尚未放開的持續中長按套尾部規則。
   */
  release(event: InputEvent): ReleaseOutcome {
    this.expiry(event.t);
    for (const [i, h] of this.activeHolds) {
      if (h.released) continue;
      if (this.chart[i]!.key !== event.key) continue;
      if (event.t < this.breakPoint(i) - EPS) {
        // 提早放開 → 破:判 Miss、斷 combo。
        this.activeHolds.delete(i);
        this.resolve(i, 'miss');
        return { kind: 'break', noteIndex: i };
      }
      // 撐過破壞點 → 安全;結果留待 expiry 在尾部鎖定。標記已放,忽略後續同鍵放開。
      h.released = true;
      return { kind: 'safe', noteIndex: i };
    }
    return { kind: 'ignored' }; // 無對應長按的放開,不罰
  }

  get currentCombo(): number {
    return this.combo;
  }

  /** 查單顆音符目前的判定(尚未解算回 null)。供即時渲染收起已判音符。 */
  resultAt(i: number): Judgment | null {
    return this.results[i] ?? null;
  }

  /**
   * 是否所有音符皆已解算(無未定案、無持續中長按)。持續中的長按 results[i] 維持 null,
   * 故按住未鎖定期間為 false。用於高速公路的尾段判斷:為 true 時成績已成定局,
   * 最後一顆之後只剩沒有音符的尾巴,可安全地讓玩家按鍵直接結束(見 grilling 2026-07-12)。
   */
  get allResolved(): boolean {
    return this.results.every((r) => r !== null);
  }

  /** 目前已解算音符的判定(未解算的不含)。 */
  judgments(): Judgment[] {
    return this.results.filter((j): j is Judgment => j !== null);
  }

  summary(): JudgeSummary {
    const judged = this.judgments();
    const counts = { perfect: 0, good: 0, miss: 0 };
    let weightSum = 0;
    for (const j of judged) {
      counts[j.result] += 1;
      if (j.result !== 'miss') weightSum += WEIGHT[j.result];
    }
    const accuracy = judged.length === 0 ? 0 : weightSum / judged.length;
    return {
      accuracy,
      maxCombo: this.maxCombo,
      combo: this.combo,
      counts,
      extras: this.extras,
      grade: gradeFor(accuracy),
      fullCombo: judged.length > 0 && counts.miss === 0,
    };
  }
}

/**
 * 批次判定(純函式接縫)。
 * @param chart 已編譯的 TypingChart
 * @param events 帶時戳按鍵事件(任意順序;內部依 t 穩定排序)
 * @param config 窗寬 + offset
 * @param nowSec 觀察到的時間上限;省略 = 歌曲結束(全部音符解算)
 */
export function judge(
  chart: TypingChart,
  events: readonly InputEvent[],
  config: JudgeConfig,
  nowSec = Infinity,
): { judgments: Judgment[]; summary: JudgeSummary } {
  const judger = new Judger(chart, config);
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map(({ e }) => e);
  for (const e of ordered) {
    if (e.t > nowSec) break; // 尚未觀察到的事件
    if (e.up) judger.release(e);
    else judger.press(e);
  }
  judger.expiry(nowSec);
  return { judgments: judger.judgments(), summary: judger.summary() };
}
