// highwayReducer 的測試:純函式,手寫 fixtures 斷言每個轉移與 effect 清單,不涉及 DOM/音訊/計時器。
import { describe, expect, it } from 'vitest';
import { highwayReducer, INITIAL_HIGHWAY_STATE, type HighwayState } from '../highwayState.ts';

const playing = (over: Partial<HighwayState> = {}): HighwayState => ({
  phase: 'playing',
  tailReached: false,
  launchKind: 'fresh',
  ...over,
});
const paused = (over: Partial<HighwayState> = {}): HighwayState => ({
  phase: 'paused',
  tailReached: false,
  launchKind: 'resume',
  ...over,
});

describe('restart', () => {
  it('從 idle(掛載時)重玩 → countdown,重建 + 開倒數(fresh)', () => {
    const { state, effects } = highwayReducer(INITIAL_HIGHWAY_STATE, { type: 'restart' });
    expect(state).toEqual({ phase: 'countdown', tailReached: false, launchKind: 'fresh' });
    expect(effects).toEqual([{ type: 'resetForNewRun' }, { type: 'startCountdown', kind: 'fresh' }]);
  });

  it('從任何狀態(如 ended、tailReached 殘留)重玩都會清空 tailReached、launchKind 回 fresh', () => {
    const from = playing({ phase: 'ended', tailReached: true, launchKind: 'resume' });
    const { state } = highwayReducer(from, { type: 'restart' });
    expect(state).toEqual({ phase: 'countdown', tailReached: false, launchKind: 'fresh' });
  });
});

describe('controlKey(playing)', () => {
  it('未進尾段 → 暫停,launchKind 轉為 resume', () => {
    const { state, effects } = highwayReducer(playing({ launchKind: 'fresh' }), { type: 'controlKey' });
    expect(state).toEqual(playing({ phase: 'paused', launchKind: 'resume' }));
    expect(effects).toEqual([{ type: 'pause' }]);
  });

  it('已進尾段 → 直接結束(不是暫停),tailReached 歸零', () => {
    const { state, effects } = highwayReducer(playing({ tailReached: true }), { type: 'controlKey' });
    expect(state).toEqual(playing({ phase: 'ended', tailReached: false }));
    expect(effects).toEqual([{ type: 'finish' }]);
  });
});

describe('controlKey(paused) / resumeClicked', () => {
  it('paused → countdown,沿用原 launchKind(resume)開倒數', () => {
    const p = paused({ launchKind: 'resume' });
    const viaKey = highwayReducer(p, { type: 'controlKey' });
    const viaClick = highwayReducer(p, { type: 'resumeClicked' });
    for (const { state, effects } of [viaKey, viaClick]) {
      expect(state).toEqual({ ...p, phase: 'countdown' });
      expect(effects).toEqual([{ type: 'startCountdown', kind: 'resume' }]);
    }
  });

  it('resumeClicked 在非 paused 狀態下是 no-op', () => {
    const { state, effects } = highwayReducer(playing(), { type: 'resumeClicked' });
    expect(state).toEqual(playing());
    expect(effects).toEqual([]);
  });
});

describe('controlKey(countdown) / tabHidden(countdown)', () => {
  it('倒數中按控制鍵 → 打斷回 paused', () => {
    const cd: HighwayState = { phase: 'countdown', tailReached: false, launchKind: 'fresh' };
    const { state, effects } = highwayReducer(cd, { type: 'controlKey' });
    expect(state).toEqual({ ...cd, phase: 'paused' });
    expect(effects).toEqual([{ type: 'cancelCountdown' }]);
  });

  it('倒數中切背景 → 同樣打斷回 paused', () => {
    const cd: HighwayState = { phase: 'countdown', tailReached: false, launchKind: 'resume' };
    const { state, effects } = highwayReducer(cd, { type: 'tabHidden' });
    expect(state).toEqual({ ...cd, phase: 'paused' });
    expect(effects).toEqual([{ type: 'cancelCountdown' }]);
  });
});

describe('tabHidden(playing)', () => {
  it('遊玩中切背景 → 暫停,launchKind 轉為 resume(與按鍵暫停一致)', () => {
    const { state, effects } = highwayReducer(playing({ tailReached: true }), { type: 'tabHidden' });
    // 切背景不看 tailReached,一律暫停(不同於 controlKey 的尾段直接結束)。
    expect(state).toEqual(playing({ phase: 'paused', tailReached: true, launchKind: 'resume' }));
    expect(effects).toEqual([{ type: 'pause' }]);
  });
});

describe('controlKey / tabHidden 在 idle / ended 下忽略', () => {
  it.each(['idle', 'ended'] as const)('%s 狀態下 controlKey 是 no-op', (phase) => {
    const s: HighwayState = { phase, tailReached: false, launchKind: 'fresh' };
    expect(highwayReducer(s, { type: 'controlKey' })).toEqual({ state: s, effects: [] });
  });
  it.each(['idle', 'paused', 'ended'] as const)('%s 狀態下 tabHidden 是 no-op', (phase) => {
    const s: HighwayState = { phase, tailReached: false, launchKind: 'fresh' };
    expect(highwayReducer(s, { type: 'tabHidden' })).toEqual({ state: s, effects: [] });
  });
});

describe('allNotesResolved', () => {
  it('playing 中首次觸發 → tailReached 轉 true,無 effect(顯示由呼叫端依 state 渲染)', () => {
    const { state, effects } = highwayReducer(playing(), { type: 'allNotesResolved' });
    expect(state).toEqual(playing({ tailReached: true }));
    expect(effects).toEqual([]);
  });
  it('冪等:已 tailReached 時再收到 → 狀態不變(同一物件語意)', () => {
    const s = playing({ tailReached: true });
    expect(highwayReducer(s, { type: 'allNotesResolved' })).toEqual({ state: s, effects: [] });
  });
  it('非 playing 狀態下忽略', () => {
    const s = paused();
    expect(highwayReducer(s, { type: 'allNotesResolved' })).toEqual({ state: s, effects: [] });
  });
});

describe('countdownFinished', () => {
  it('countdown → playing,依 launchKind 觸發對應 launch effect', () => {
    const cd: HighwayState = { phase: 'countdown', tailReached: false, launchKind: 'resume' };
    const { state, effects } = highwayReducer(cd, { type: 'countdownFinished' });
    expect(state).toEqual({ ...cd, phase: 'playing' });
    expect(effects).toEqual([{ type: 'launch', kind: 'resume' }]);
  });
  it('非 countdown 狀態下忽略(防呆)', () => {
    const s = playing();
    expect(highwayReducer(s, { type: 'countdownFinished' })).toEqual({ state: s, effects: [] });
  });
});

describe('naturalEnd', () => {
  it('自然播畢 → ended,清 tailReached,觸發 finish', () => {
    const { state, effects } = highwayReducer(playing({ tailReached: true }), { type: 'naturalEnd' });
    expect(state).toEqual(playing({ phase: 'ended', tailReached: false }));
    expect(effects).toEqual([{ type: 'finish' }]);
  });
  it('已 ended 時防重入(不會與尾段直接結束搶跑)', () => {
    const s = playing({ phase: 'ended' });
    expect(highwayReducer(s, { type: 'naturalEnd' })).toEqual({ state: s, effects: [] });
  });
});
