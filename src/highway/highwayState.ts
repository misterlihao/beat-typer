// 高速公路遊戲流程狀態機(issue 13 + grilling 2026-07-12):純函式決策層,無 DOM / 音訊 / 計時器依賴。
// idle → countdown → playing ⇄ paused;playing → ended。countdown = 進 playing 前的統一 321 前奏
// (首玩/續玩/重玩三入口共用)。倒數本身的計時/音效由呼叫端執行(startCountdown effect 的實作),
// 本檔只決定「什麼時候該倒數、倒數完後去哪、被打斷回哪」。介面設計見 docs/adr/0014。
//
// 輸入(HighwayEvent)刻意不含鍵盤/瀏覽器細節(是否 repeat、是不是 Space/Escape、document.hidden 與否)
// ——那些是呼叫端把原始輸入轉譯成「這是不是一次有效的控制事件」的職責,不屬於流程決策本身。

export type HighwayPhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'ended';

/** 倒數結束後要用哪種方式續播:fresh=從 0(首玩/重玩),resume=從凍結位置(暫停續玩)。 */
export type LaunchKind = 'fresh' | 'resume';

export interface HighwayState {
  readonly phase: HighwayPhase;
  /** 所有音符已判定完(尾段):playing 中觸發,決定 controlKey 事件是暫停還是直接結束。 */
  readonly tailReached: boolean;
  readonly launchKind: LaunchKind;
}

export const INITIAL_HIGHWAY_STATE: HighwayState = { phase: 'idle', tailReached: false, launchKind: 'fresh' };

export type HighwayEvent =
  | { readonly type: 'restart' } // 首玩(掛載時)/ 重新開始按鈕
  | { readonly type: 'resumeClicked' } // 「繼續」按鈕
  | { readonly type: 'controlKey' } // Space / Escape(呼叫端已篩過 repeat 與鍵碼)
  | { readonly type: 'tabHidden' } // 分頁切到背景(呼叫端已篩過 document.hidden)
  | { readonly type: 'allNotesResolved' } // judger.allResolved 由 false 變 true
  | { readonly type: 'countdownFinished' } // 倒數 effect 跑完 321
  | { readonly type: 'naturalEnd' }; // 音訊自然播畢(player.onEnded)

export type HighwayEffect =
  | { readonly type: 'resetForNewRun' } // 重建 Judger、清視覺、定格在起跑畫面
  | { readonly type: 'startCountdown'; readonly kind: LaunchKind }
  | { readonly type: 'cancelCountdown' } // 倒數被打斷 → 回暫停覆蓋層
  | { readonly type: 'launch'; readonly kind: LaunchKind } // 倒數跑完 → 真正開始播放
  | { readonly type: 'pause' }
  | { readonly type: 'finish' }; // 收尾結算(自然播畢 / 尾段直接結束共用)

export interface HighwayTransition {
  readonly state: HighwayState;
  readonly effects: readonly HighwayEffect[];
}

const to = (state: HighwayState, effects: readonly HighwayEffect[] = []): HighwayTransition => ({ state, effects });

/** 依現有狀態 + 事件決定下一狀態與該執行的 effect 清單。純函式,呼叫端負責真正執行 effect。 */
export function highwayReducer(state: HighwayState, event: HighwayEvent): HighwayTransition {
  switch (event.type) {
    case 'restart':
      // 任何狀態下皆可重玩(對齊原行為:重建 Judger、清視覺、經倒數後從 0 播)。
      return to({ phase: 'countdown', tailReached: false, launchKind: 'fresh' }, [
        { type: 'resetForNewRun' },
        { type: 'startCountdown', kind: 'fresh' },
      ]);

    case 'resumeClicked':
      if (state.phase !== 'paused') return to(state);
      return to({ ...state, phase: 'countdown' }, [{ type: 'startCountdown', kind: state.launchKind }]);

    case 'controlKey':
      if (state.phase === 'playing') {
        if (state.tailReached) {
          // 尾段(成績已定,只剩無音符的尾巴):兩鍵收斂成「直接結束」而非暫停。
          return to({ ...state, phase: 'ended', tailReached: false }, [{ type: 'finish' }]);
        }
        return to({ ...state, phase: 'paused', launchKind: 'resume' }, [{ type: 'pause' }]);
      }
      if (state.phase === 'paused') {
        return to({ ...state, phase: 'countdown' }, [{ type: 'startCountdown', kind: state.launchKind }]);
      }
      if (state.phase === 'countdown') {
        return to({ ...state, phase: 'paused' }, [{ type: 'cancelCountdown' }]);
      }
      return to(state); // idle / ended:非遊戲鍵,忽略

    case 'tabHidden':
      // 背景凍結 rAF 但音訊續播,回來會一次判一堆 Miss、combo 整斷,故自動暫停/打斷倒數。
      if (state.phase === 'playing') {
        return to({ ...state, phase: 'paused', launchKind: 'resume' }, [{ type: 'pause' }]);
      }
      if (state.phase === 'countdown') {
        return to({ ...state, phase: 'paused' }, [{ type: 'cancelCountdown' }]);
      }
      return to(state);

    case 'allNotesResolved':
      if (state.phase !== 'playing' || state.tailReached) return to(state); // 冪等:只在首次觸發
      return to({ ...state, tailReached: true });

    case 'countdownFinished':
      if (state.phase !== 'countdown') return to(state); // 防呆:理論上只在倒數中會收到
      return to({ ...state, phase: 'playing' }, [{ type: 'launch', kind: state.launchKind }]);

    case 'naturalEnd':
      if (state.phase === 'ended') return to(state); // 防重入(與尾段直接結束搶跑)
      return to({ ...state, phase: 'ended', tailReached: false }, [{ type: 'finish' }]);
  }
}
