// judge 次接縫測試:手寫 chart + 帶時戳按鍵事件 fixtures,斷言判定與 summary。
import { describe, expect, it } from 'vitest';
import type { Note } from '../../compile/types.ts';
import { Judger, judge } from '../judge.ts';
import { DEFAULT_JUDGE_CONFIG, type InputEvent, type JudgeConfig } from '../types.ts';

// hand/finger/bank 對判定無關,填佔位值。
function pnote(tSec: number, key: string, kind: Note['kind'] = 'press'): Note {
  return { tSec, key, kind, hand: 'left', finger: 'index', bank: 'home' };
}
const ev = (t: number, key: string): InputEvent => ({ t, key });
const cfg: JudgeConfig = DEFAULT_JUDGE_CONFIG; // perfect 0.045、good 0.09、offset 0

describe('judge — 節奏分級', () => {
  it('窗內近 → Perfect(delta 記錄正負)', () => {
    const { judgments, summary } = judge([pnote(1, 'KeyA')], [ev(1.03, 'KeyA')], cfg);
    expect(judgments[0]).toMatchObject({ noteIndex: 0, result: 'perfect' });
    expect(judgments[0]!.deltaSec).toBeCloseTo(0.03, 10);
    expect(summary).toMatchObject({ accuracy: 1, maxCombo: 1, grade: 'S', fullCombo: true });
  });

  it('窗內遠 → Good(早按 delta 為負)', () => {
    const { judgments, summary } = judge([pnote(1, 'KeyA')], [ev(0.93, 'KeyA')], cfg);
    expect(judgments[0]).toMatchObject({ result: 'good' });
    expect(judgments[0]!.deltaSec).toBeCloseTo(-0.07, 10);
    expect(summary.accuracy).toBeCloseTo(0.5, 10);
  });

  it('邊界:|Δ|=0.045 → Perfect、|Δ|=0.09 → Good', () => {
    expect(judge([pnote(1, 'KeyA')], [ev(1.045, 'KeyA')], cfg).judgments[0]!.result).toBe('perfect');
    expect(judge([pnote(1, 'KeyA')], [ev(1.09, 'KeyA')], cfg).judgments[0]!.result).toBe('good');
  });

  it('出窗未敲到 → Miss', () => {
    const { judgments, summary } = judge([pnote(1, 'KeyA')], [], cfg);
    expect(judgments[0]).toMatchObject({ result: 'miss' });
    expect(judgments[0]!.deltaSec).toBeUndefined();
    expect(summary).toMatchObject({ accuracy: 0, maxCombo: 0, grade: 'D', fullCombo: false });
  });
});

describe('judge — 錯鍵與多餘按鍵', () => {
  it('窗內敲錯鍵 → 該音符 Miss 且斷 combo', () => {
    const { judgments, summary } = judge([pnote(1, 'KeyA')], [ev(1.0, 'KeyS')], cfg);
    expect(judgments[0]).toMatchObject({ result: 'miss' });
    expect(summary.counts).toMatchObject({ perfect: 0, good: 0, miss: 1 });
    expect(summary.extras).toBe(0); // 錯鍵不算多餘按鍵
  });

  it('窗外多餘按鍵 → 不斷 combo、不扣準確率、僅計數', () => {
    // 命中一顆(combo 1),再一個遠離任何音符的多餘按鍵。
    const { summary } = judge([pnote(1, 'KeyA')], [ev(1, 'KeyA'), ev(5, 'KeyA')], cfg);
    expect(summary).toMatchObject({ accuracy: 1, maxCombo: 1, combo: 1, extras: 1, fullCombo: true });
  });

  it('多顆多餘按鍵完全不影響準確率', () => {
    const { summary } = judge(
      [pnote(1, 'KeyA')],
      [ev(1, 'KeyA'), ev(3, 'KeyF'), ev(3.2, 'KeyJ'), ev(3.4, 'KeyK')],
      cfg,
    );
    expect(summary.accuracy).toBe(1);
    expect(summary.extras).toBe(3);
  });
});

describe('judge — combo 與時間順序', () => {
  it('連中累積、Miss 歸零、maxCombo 記最大', () => {
    const chart = [pnote(1, 'KeyA'), pnote(2, 'KeyA'), pnote(3, 'KeyA'), pnote(4, 'KeyA')];
    // 中 1、2;3 敲錯鍵;中 4。
    const { summary } = judge(chart, [ev(1, 'KeyA'), ev(2, 'KeyA'), ev(3, 'KeyS'), ev(4, 'KeyA')], cfg);
    expect(summary.maxCombo).toBe(2);
    expect(summary.combo).toBe(1);
    expect(summary.counts).toMatchObject({ perfect: 3, miss: 1 });
  });

  it('晚 beat 先命中、早 beat 後過期:combo 依解算時間序', () => {
    // A@1.0 KeyA(沒敲)、B@1.05 KeyB(1.05 命中)。A 於 1.09 過期 Miss。
    const chart = [pnote(1.0, 'KeyA'), pnote(1.05, 'KeyB')];
    const { summary } = judge(chart, [ev(1.05, 'KeyB')], cfg);
    expect(summary.maxCombo).toBe(1); // B 命中在前、A 過期在後
    expect(summary.counts).toMatchObject({ perfect: 1, miss: 1 });
  });
});

describe('judge — 跨手同拍', () => {
  it('同 tSec 兩顆(不同鍵)各自靠鍵配對,都命中', () => {
    const chart = [pnote(1, 'KeyA'), pnote(1, 'KeyK')];
    const { judgments, summary } = judge(chart, [ev(1, 'KeyA'), ev(1, 'KeyK')], cfg);
    expect(judgments.map((j) => j.result)).toEqual(['perfect', 'perfect']);
    expect(summary.maxCombo).toBe(2);
  });
});

describe('judge — 準確率與評級', () => {
  it('2 Perfect + 2 Miss → 0.5 → C', () => {
    const chart = [pnote(1, 'KeyA'), pnote(2, 'KeyA'), pnote(3, 'KeyA'), pnote(4, 'KeyA')];
    const { summary } = judge(chart, [ev(1, 'KeyA'), ev(2, 'KeyA')], cfg);
    expect(summary.accuracy).toBeCloseTo(0.5, 10);
    expect(summary.grade).toBe('C');
    expect(summary.counts).toMatchObject({ perfect: 2, miss: 2 });
  });

  it('offset 生效:offset 0.1 時,t=1.1 才是 Perfect', () => {
    const c: JudgeConfig = { ...cfg, offsetSec: 0.1 };
    expect(judge([pnote(1, 'KeyA')], [ev(1.1, 'KeyA')], c).judgments[0]!.result).toBe('perfect');
    // 沒補償時 t=1.0 反而變成 |−0.1|>good → 出窗 → Miss
    expect(judge([pnote(1, 'KeyA')], [ev(1.0, 'KeyA')], c).judgments[0]!.result).toBe('miss');
  });
});

describe('judge — nowSec 部分觀察(即時狀態)', () => {
  it('nowSec 未到期的音符維持待判、不算 Miss', () => {
    const chart = [pnote(1, 'KeyA'), pnote(3, 'KeyA')];
    const partial = judge(chart, [ev(1, 'KeyA')], cfg, 2.0);
    expect(partial.judgments).toHaveLength(1); // 只有 note0 解算
    expect(partial.summary).toMatchObject({ combo: 1, accuracy: 1 });
    // 歌曲結束(nowSec=∞)後 note1 過期 Miss。
    const full = judge(chart, [ev(1, 'KeyA')], cfg);
    expect(full.judgments).toHaveLength(2);
    expect(full.summary.counts).toMatchObject({ perfect: 1, miss: 1 });
  });
});

describe('Judger — 增量原語(即時路徑共用)', () => {
  it('press 回傳即時 outcome、expiry 回傳過期 miss', () => {
    const j = new Judger([pnote(1, 'KeyA'), pnote(2, 'KeyB')], cfg);
    expect(j.press(ev(1, 'KeyA'))).toMatchObject({ kind: 'perfect', noteIndex: 0 });
    expect(j.currentCombo).toBe(1);
    expect(j.press(ev(1.5, 'KeyQ'))).toEqual({ kind: 'extra' }); // 附近無音符(note1 窗 [1.91,2.09] 外)
    expect(j.currentCombo).toBe(1); // 多餘不斷 combo
    expect(j.expiry(Infinity)).toEqual([1]); // note1 未敲到 → 過期 miss
    expect(j.currentCombo).toBe(0);
  });
});
