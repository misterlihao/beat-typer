// 鍵指派平衡器的單元測試(issue 11 的主要驗收面)。純函式 + 手寫 fixtures。
// 涵蓋:手/鍵池對應、可玩性硬底線、教學權重傾向、峰值上限、覆蓋、determinism。
import { describe, expect, it } from 'vitest';
import { assignKeys, type UnassignedNote } from '../keyAssignment.ts';
import type { Hand } from '../types.ts';

const GAP = 0.12;

const LEFT_KEYS = new Set(['KeyQ','KeyW','KeyE','KeyR','KeyA','KeyS','KeyD','KeyF','KeyZ','KeyX','KeyC','KeyV','KeyT','KeyG','KeyB']);
const RIGHT_KEYS = new Set(['KeyU','KeyI','KeyO','KeyP','KeyJ','KeyK','KeyL','Semicolon','KeyM','Comma','Period','Slash','KeyY','KeyH','KeyN']);

/** 產生一串同手 press,自 startT 起每隔 dt 秒一顆。 */
function stream(hand: Hand, count: number, dt: number, startT = 0): UnassignedNote[] {
  return Array.from({ length: count }, (_, i) => ({ tSec: startT + i * dt, hand, kind: 'press' as const }));
}

describe('鍵指派 — 手與鍵池', () => {
  it('指派的鍵永遠屬於該音符的手', () => {
    const notes = [...stream('left', 20, 0.3), ...stream('right', 20, 0.3, 0.15)].sort((a, b) => a.tSec - b.tSec);
    for (const n of assignKeys(notes, GAP)) {
      expect((n.hand === 'left' ? LEFT_KEYS : RIGHT_KEYS).has(n.key)).toBe(true);
    }
  });

  it('finger/bank 不改變手(手只由輸入的 hand 決定)', () => {
    const notes = stream('right', 10, 0.3);
    expect(assignKeys(notes, GAP).every((n) => n.hand === 'right')).toBe(true);
  });
});

describe('鍵指派 — 可玩性硬底線', () => {
  it('同手、相隔 < gap 的音符不指派同一手指', () => {
    // dt 0.05:任一顆的前方 gap 窗內至多 2 顆(0.05、0.10),≤4 指可滿足。
    const notes = stream('left', 40, 0.05);
    const out = assignKeys(notes, GAP);
    for (let i = 0; i < out.length; i++) {
      for (let j = i - 1; j >= 0 && out[i]!.tSec - out[j]!.tSec < GAP; j--) {
        expect(out[i]!.finger).not.toBe(out[j]!.finger);
      }
    }
  });

  it('hold 佔用其手指直到結束 + gap:期間的同手 press 換指', () => {
    const hold: UnassignedNote = { tSec: 0, hand: 'left', kind: 'hold', holdEndSec: 1.0 };
    const press: UnassignedNote = { tSec: 0.5, hand: 'left', kind: 'press' };
    const [h, p] = assignKeys([hold, press], GAP);
    expect(h!.finger).toBe('index'); // 第一顆左手 → 家排食指 KeyF
    expect(p!.finger).not.toBe('index'); // hold 期間食指被佔 → 換指
  });
});

describe('鍵指派 — 教學權重傾向(家排優先)', () => {
  const out = assignKeys(stream('left', 300, 0.3), GAP); // 間隔遠大於 gap,純權重驅動
  const byBank = { top: 0, home: 0, bottom: 0 };
  const byFinger = { index: 0, middle: 0, ring: 0, pinky: 0 };
  for (const n of out) {
    byBank[n.bank]++;
    byFinger[n.finger]++;
  }

  it('排:家排 > 上排 > 下排', () => {
    expect(byBank.home).toBeGreaterThan(byBank.top);
    expect(byBank.top).toBeGreaterThan(byBank.bottom);
  });

  it('手指:食指 > 中指 > 無名 > 小指', () => {
    expect(byFinger.index).toBeGreaterThan(byFinger.middle);
    expect(byFinger.middle).toBeGreaterThan(byFinger.ring);
    expect(byFinger.ring).toBeGreaterThan(byFinger.pinky);
  });
});

describe('鍵指派 — 峰值上限與覆蓋', () => {
  const out = assignKeys(stream('left', 300, 0.3), GAP);
  const count: Record<string, number> = {};
  for (const n of out) count[n.key] = (count[n.key] ?? 0) + 1;

  it('無單鍵佔比逼近舊的 ~13%(峰值 ≤ 16%)', () => {
    const peak = Math.max(...Object.values(count)) / out.length;
    expect(peak).toBeLessThanOrEqual(0.16);
  });

  it('足夠長的譜覆蓋整個手的鍵池(15 鍵全中)', () => {
    expect(Object.keys(count)).toHaveLength(15);
  });

  it('家排食指 KeyF 不再被餓死(明顯高於最低權重鍵)', () => {
    expect(count['KeyF']!).toBeGreaterThan(count['KeyZ']!);
  });
});

describe('鍵指派 — determinism', () => {
  it('同一批音符指派兩次 → 完全相同', () => {
    const notes = [...stream('left', 30, 0.07), ...stream('right', 30, 0.09, 0.02)].sort((a, b) => a.tSec - b.tSec);
    expect(assignKeys(notes, GAP)).toEqual(assignKeys(notes, GAP));
  });
});

describe('鍵指派 — 鍵群(issue 15)', () => {
  // 各鍵群的排/指約束(直接測過濾語義,不硬編鍵集)+ 每手覆蓋鍵數。
  const bothHands = () => [...stream('left', 300, 0.3), ...stream('right', 300, 0.3, 0.15)].sort((a, b) => a.tSec - b.tSec);
  const distinctKeys = (out: ReturnType<typeof assignKeys>, hand: Hand) =>
    new Set(out.filter((n) => n.hand === hand).map((n) => n.key));

  it('home:只用家排', () => {
    const out = assignKeys(bothHands(), GAP, 'home');
    expect(out.every((n) => n.bank === 'home')).toBe(true);
    expect(distinctKeys(out, 'left').size).toBe(5); // A S D F + 內 G
    expect(distinctKeys(out, 'right').size).toBe(5);
  });

  it('home-top:只用家排+上排', () => {
    const out = assignKeys(bothHands(), GAP, 'home-top');
    expect(out.every((n) => n.bank === 'home' || n.bank === 'top')).toBe(true);
    expect(distinctKeys(out, 'left').size).toBe(10);
  });

  it('index-middle:只用食指/中指(含食指內側鍵)', () => {
    const out = assignKeys(bothHands(), GAP, 'index-middle');
    expect(out.every((n) => n.finger === 'index' || n.finger === 'middle')).toBe(true);
    expect(distinctKeys(out, 'left').size).toBe(9); // index×3 + middle×3 + 內側 index×3
  });

  it('ring-pinky:只用無名/小指(無內側鍵)', () => {
    const out = assignKeys(bothHands(), GAP, 'ring-pinky');
    expect(out.every((n) => n.finger === 'ring' || n.finger === 'pinky')).toBe(true);
    expect(distinctKeys(out, 'left').size).toBe(6); // ring×3 + pinky×3
  });

  it("預設 'all' 與不帶 keyGroup 位元級相同(不回歸 issue 11)", () => {
    const notes = bothHands();
    expect(assignKeys(notes, GAP, 'all')).toEqual(assignKeys(notes, GAP));
    expect(distinctKeys(assignKeys(notes, GAP, 'all'), 'left').size).toBe(15);
  });

  it('雙手群不改變手歸屬與音符數(顏色→手不變)', () => {
    const notes = bothHands();
    const out = assignKeys(notes, GAP, 'home');
    expect(out).toHaveLength(notes.length); // 不丟音符
    expect(out.every((n, i) => n.hand === notes[i]!.hand)).toBe(true); // 手不變
  });

  it('鍵群縮小致手指全被佔 → 只在群內放寬(不借群外鍵)', () => {
    // index-middle 僅 2 指;超快同手串必逼出同指重用,但鍵必仍屬該群(finger∈{index,middle})。
    const out = assignKeys(stream('left', 40, 0.02), GAP, 'index-middle');
    expect(out.every((n) => n.finger === 'index' || n.finger === 'middle')).toBe(true);
  });

  it('鍵群 determinism:同 (音符+群) 兩次相同', () => {
    const notes = stream('left', 30, 0.07);
    expect(assignKeys(notes, GAP, 'home')).toEqual(assignKeys(notes, GAP, 'home'));
  });
});
