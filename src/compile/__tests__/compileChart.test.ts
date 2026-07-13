// compileChart 的主要測試:手寫 inline fixture,斷言固定輸出。
// issue 11 後映射改為「鍵指派」——鍵不再由位置決定,故本檔斷言的是與指派無關的行為
// (時間換算、過濾、排序、疊放收斂、hold 結構、v2↔v3 對等)與指派層的不變量
// (手=顏色、determinism、家排優先、可玩性)。鍵指派本身的細節見 keyAssignment.test.ts。
import { describe, expect, it } from 'vitest';
import { compileChart } from '../compileChart.ts';
import { glyphOf } from '../mapping.ts';

// ── fixture 建構器 ─────────────────────────────────────────
function infoDat(opts: { bpm?: number; offset?: number } = {}): string {
  return JSON.stringify({
    _version: '2.0.0',
    _beatsPerMinute: opts.bpm ?? 120,
    _songTimeOffset: opts.offset ?? 0,
    _songFilename: 'song.egg',
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: 'Standard',
        _difficultyBeatmaps: [{ _difficulty: 'ExpertPlus', _beatmapFilename: 'd.dat' }],
      },
    ],
  });
}
function note(time: number, lineIndex: number, lineLayer: number, type: number) {
  return { _time: time, _lineIndex: lineIndex, _lineLayer: lineLayer, _type: type, _cutDirection: 1 };
}
function diffDat(notes: ReturnType<typeof note>[]): string {
  return JSON.stringify({ _version: '2.0.0', _notes: notes, _obstacles: [], _events: [] });
}
function compile(notes: ReturnType<typeof note>[], opts: { bpm?: number; offset?: number } = {}) {
  return compileChart(
    { infoText: infoDat(opts), difficultyFiles: { 'd.dat': diffDat(notes) } },
    'ExpertPlus',
  );
}

// ── v3 fixture 建構器(欄位順序刻意同 v2 的 note():time, col, layer, color)──
function noteV3(b: number, x: number, y: number, c: number) {
  return { b, x, y, c, d: 1, a: 0 };
}
function diffDatV3(notes: ReturnType<typeof noteV3>[]): string {
  return JSON.stringify({
    version: '3.2.0',
    colorNotes: notes,
    bombNotes: [],
    obstacles: [],
    sliders: [],
    burstSliders: [],
  });
}
function compileV3(notes: ReturnType<typeof noteV3>[], opts: { bpm?: number; offset?: number } = {}) {
  return compileChart(
    { infoText: infoDat(opts), difficultyFiles: { 'd.dat': diffDatV3(notes) } },
    'ExpertPlus',
  );
}

describe('compileChart — 手由顏色決定(唯一保留的位置語義)', () => {
  it('紅=左手、藍=右手,與欄/列無關', () => {
    const [red] = compile([note(0, 2, 0, 0)]);
    const [blue] = compile([note(0, 2, 0, 1)]);
    expect(red!.hand).toBe('left');
    expect(blue!.hand).toBe('right');
  });

  it('每顆音符的 finger/bank 與 key 相容,且 key 屬正確的手', () => {
    // 左手鍵集合與右手鍵集合(全格 + 內側)。
    const LEFT = new Set(['KeyQ','KeyW','KeyE','KeyR','KeyA','KeyS','KeyD','KeyF','KeyZ','KeyX','KeyC','KeyV','KeyT','KeyG','KeyB']);
    const RIGHT = new Set(['KeyU','KeyI','KeyO','KeyP','KeyJ','KeyK','KeyL','Semicolon','KeyM','Comma','Period','Slash','KeyY','KeyH','KeyN']);
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(1, 1, 2, 1), noteV3(2, 3, 0, 0), noteV3(3, 2, 1, 1)]);
    for (const n of chart) {
      const set = n.hand === 'left' ? LEFT : RIGHT;
      expect(set.has(n.key)).toBe(true);
    }
  });
});

describe('compileChart — 家排優先(教學權重最高的鍵先被指派)', () => {
  it('第一顆左手音符 → 家排食指 KeyF', () => {
    const [n] = compile([note(0, 0, 0, 0)]);
    expect(n).toMatchObject({ key: 'KeyF', hand: 'left', finger: 'index', bank: 'home', kind: 'press' });
  });

  it('第一顆右手音符 → 家排食指 KeyJ', () => {
    const [n] = compile([note(0, 3, 2, 1)]);
    expect(n).toMatchObject({ key: 'KeyJ', hand: 'right', finger: 'index', bank: 'home' });
  });
});

describe('compileChart — determinism(單場內)', () => {
  it('同一批音符編譯兩次 → 完全相同', () => {
    const notes = [note(0, 0, 1, 0), note(0.5, 2, 2, 1), note(1, 3, 0, 0), note(1.5, 1, 1, 1)];
    expect(compile(notes)).toEqual(compile(notes));
  });
});

describe('compileChart — 可玩性硬底線(同手緊湊時間窗不同指)', () => {
  it('同手兩顆相距 <120ms(非疊放)→ 指派不同手指', () => {
    // BPM 120 → secPerBeat 0.5。beat 0 與 0.2:beat 差 0.2 ≥ 1/8(不收斂),時間差 0.1s < 0.12s(可玩性生效)。
    const chart = compile([note(0, 0, 1, 0), note(0.2, 1, 1, 0)]);
    expect(chart).toHaveLength(2);
    expect(chart[0]!.hand).toBe('left');
    expect(chart[1]!.hand).toBe('left');
    expect(chart[0]!.finger).not.toBe(chart[1]!.finger);
  });
});

describe('compileChart — beat→秒換算', () => {
  it('BPM 120、offset 0.05:beat 2 → tSec 1.05', () => {
    const [n] = compile([note(2, 0, 1, 0)], { bpm: 120, offset: 0.05 });
    expect(n!.tSec).toBeCloseTo(1.05, 10);
  });

  it('BPM 60、offset 0:beat 1 → tSec 1.0', () => {
    const [n] = compile([note(1, 0, 1, 0)], { bpm: 60, offset: 0 });
    expect(n!.tSec).toBeCloseTo(1.0, 10);
  });

  it('offset 為負也生效', () => {
    const [n] = compile([note(0, 0, 1, 0)], { bpm: 120, offset: -0.1 });
    expect(n!.tSec).toBeCloseTo(-0.1, 10);
  });
});

describe('compileChart — 過濾與排序', () => {
  it('炸彈(type 3)與其他非紅藍音符被濾除', () => {
    const chart = compile([note(0, 0, 0, 3), note(1, 0, 1, 0), note(2, 0, 0, 5)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]!.hand).toBe('left');
  });

  it('輸出依 tSec 遞增排序', () => {
    const chart = compile([note(3, 0, 1, 0), note(1, 0, 1, 0), note(2, 0, 1, 0)]);
    expect(chart.map((n) => n.tSec)).toEqual([...chart.map((n) => n.tSec)].sort((a, b) => a - b));
    expect(chart).toHaveLength(3);
  });
});

describe('compileChart — 錯誤處理', () => {
  it('v3 colorNotes 不是陣列丟出清楚錯誤', () => {
    const infoText = infoDat();
    const bad = JSON.stringify({ version: '3.2.0', colorNotes: {} });
    expect(() =>
      compileChart({ infoText, difficultyFiles: { 'd.dat': bad } }, 'ExpertPlus'),
    ).toThrow(/colorNotes/);
  });

  it('無法辨識的譜面版本丟出清楚錯誤', () => {
    const infoText = infoDat();
    const bad = JSON.stringify({ version: '4.0.0' });
    expect(() =>
      compileChart({ infoText, difficultyFiles: { 'd.dat': bad } }, 'ExpertPlus'),
    ).toThrow(/不支援的譜面版本/);
  });

  it('找不到難度名丟出清楚錯誤', () => {
    expect(() =>
      compileChart({ infoText: infoDat(), difficultyFiles: { 'd.dat': diffDat([]) } }, 'Nonexistent'),
    ).toThrow(/找不到難度/);
  });

  it('缺少難度檔丟出清楚錯誤', () => {
    expect(() =>
      compileChart({ infoText: infoDat(), difficultyFiles: {} }, 'ExpertPlus'),
    ).toThrow(/缺少難度檔/);
  });
});

describe('compileChart — v2↔v3 對等', () => {
  it('同一批邏輯音符,v2 與 v3 產出完全一致的 TypingChart', () => {
    // [time/beat, 欄, 列, 顏色] — 跨手、跨欄、跨列、含同拍
    const cells: Array<[number, number, number, number]> = [
      [0, 0, 1, 0],
      [0.5, 2, 2, 0],
      [1, 3, 0, 0],
      [1, 0, 2, 1], // 與上一顆同拍,測穩定排序
      [2, 1, 1, 1],
      [3, 3, 2, 1],
    ];
    const opts = { bpm: 128, offset: 0.03 };
    const v2chart = compile(
      cells.map(([t, x, y, c]) => note(t, x, y, c)),
      opts,
    );
    const v3chart = compileV3(
      cells.map(([b, x, y, c]) => noteV3(b, x, y, c)),
      opts,
    );
    expect(v3chart).toEqual(v2chart);
    expect(v3chart).toHaveLength(cells.length);
  });
});

describe('compileChart — v3 忽略非音符陣列', () => {
  it('v3 炸彈/牆/鏈/弧陣列被忽略,只讀 colorNotes', () => {
    const infoText = infoDat();
    const diff = JSON.stringify({
      version: '3.2.0',
      colorNotes: [noteV3(0, 0, 1, 0)],
      bombNotes: [{ b: 0, x: 1, y: 1 }],
      obstacles: [{ b: 0, x: 0, y: 0, d: 1, w: 1, h: 1 }],
      burstSliders: [{ b: 0, x: 0, y: 0, c: 0 }],
    });
    const chart = compileChart({ infoText, difficultyFiles: { 'd.dat': diff } }, 'ExpertPlus');
    expect(chart).toHaveLength(1);
    expect(chart[0]!.kind).toBe('press');
  });

  it('v3 省略 c 欄位視為紅(0/左手)——BS 對預設值採省略慣例(見 overdose Normal 左手消失)', () => {
    const infoText = infoDat();
    const diff = JSON.stringify({
      version: '3.3.0',
      colorNotes: [{ b: 0, x: 1, d: 1 }, { b: 1, x: 2, c: 1, d: 1 }], // 第一顆缺 c、缺 y
      bombNotes: [],
      obstacles: [],
      sliders: [{ b: 2, x: 0, y: 1, tb: 4, tx: 0, ty: 1, d: 1 }], // 弧線缺 c
    });
    const chart = compileChart({ infoText, difficultyFiles: { 'd.dat': diff } }, 'ExpertPlus');
    expect(chart).toHaveLength(3);
    expect(chart[0]).toMatchObject({ hand: 'left', kind: 'press' }); // 缺 c → 左手
    expect(chart[1]).toMatchObject({ hand: 'right', kind: 'press' });
    expect(chart[2]).toMatchObject({ hand: 'left', kind: 'hold' }); // 弧線缺 c → 左手
  });
});

describe('compileChart — 同手疊放收斂(< 1/8 beat → 單一音符)', () => {
  it('同手兩顆相距 < 1/8 beat → 收斂成一顆(tSec 取錨點),交給鍵指派', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0.1, 1, 1, 0)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ hand: 'left', kind: 'press', tSec: 0 });
  });

  it('收斂後的音符不再固定落內側鍵:與同位置的單顆音符得到相同指派', () => {
    const lone = compileV3([noteV3(0, 0, 1, 0)]);
    const stacked = compileV3([noteV3(0, 0, 1, 0), noteV3(0.1, 1, 1, 0)]);
    expect(stacked[0]!.key).toBe(lone[0]!.key); // 皆為該手第一顆 → 同一鍵(KeyF),非內側鍵
  });

  it('錨點制:beat 0/0.1/0.2 → {0,0.1} 疊放、{0.2} 單顆,不鏈式串接', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0.1, 1, 1, 0), noteV3(0.2, 2, 0, 0)]);
    expect(chart).toHaveLength(2);
    expect(chart[0]!.tSec).toBe(0); // 疊放收斂
    expect(chart[1]!.tSec).toBeCloseTo(0.1, 10); // 單顆(BPM120:beat0.2→0.1s)
  });

  it('恰好相距 1/8 beat → 連打(各自保留),非疊放', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0.125, 0, 1, 0)]);
    expect(chart).toHaveLength(2);
  });

  it('跨手同拍 → 兩顆各自保留、共用 tSec,不收斂', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0, 1, 1, 1)]);
    expect(chart).toHaveLength(2);
    expect(chart.map((n) => n.hand).sort()).toEqual(['left', 'right']);
    expect(chart.every((n) => n.tSec === 0)).toBe(true);
  });

  it('v2 疊放同樣收斂(行為與格式無關)', () => {
    const chart = compile([note(0, 0, 1, 0), note(0, 1, 1, 0)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]!.hand).toBe('left');
  });
});

describe('compileChart — v3 弧線 → hold', () => {
  function diffWithSliders(
    notes: ReturnType<typeof noteV3>[],
    sliders: Array<{ c: number; b: number; x: number; y: number; tb: number; tx: number; ty: number }>,
  ): string {
    return JSON.stringify({ version: '3.2.0', colorNotes: notes, sliders, bombNotes: [], obstacles: [] });
  }
  const compileSliders = (
    notes: ReturnType<typeof noteV3>[],
    sliders: Parameters<typeof diffWithSliders>[1],
  ) => compileChart({ infoText: infoDat(), difficultyFiles: { 'd.dat': diffWithSliders(notes, sliders) } }, 'ExpertPlus');

  it('弧線輸出 kind:hold、tSec 取 head、holdEndSec 取 tail', () => {
    const chart = compileSliders([], [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ kind: 'hold', hand: 'left', tSec: 0 });
    expect(chart[0]!.holdEndSec).toBeCloseTo(1.0, 10); // tail beat 2 → 1.0s(BPM120)
  });

  it('與 head 精確重疊的 colorNote 被濾除(不 press+hold 並存)', () => {
    const chart = compileSliders(
      [noteV3(0, 0, 1, 0), noteV3(1, 1, 1, 1)], // 第一顆與 head 重疊 → 濾除;第二顆保留
      [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }],
    );
    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ kind: 'hold', hand: 'left' });
    expect(chart[1]).toMatchObject({ kind: 'press', hand: 'right' });
  });

  it('與 tail 精確重疊的 colorNote 也被濾除', () => {
    const chart = compileSliders(
      [noteV3(2, 0, 1, 0)], // 與 tail(beat2,col0,row1,紅)重疊 → 濾除
      [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }],
    );
    expect(chart).toHaveLength(1);
    expect(chart[0]!.kind).toBe('hold');
  });

  it('壞資料:tail 不晚於 head 的弧線退化成 press(見 ADR 0010)', () => {
    const chart = compileSliders([], [{ c: 0, b: 2, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }]); // tail beat = head beat
    expect(chart).toHaveLength(1);
    expect(chart[0]!.kind).toBe('press');
    expect(chart[0]!.holdEndSec).toBeUndefined();
  });
});

describe('compileChart — 變速(BPM change)beat→秒積分', () => {
  // infoDat 預設 bpm 120(secPerBeat 0.5)、offset 0。
  const compileV3Bpm = (
    notes: ReturnType<typeof noteV3>[],
    bpmEvents: Array<{ b: number; m: number } | Record<string, unknown>>,
    opts: { bpm?: number } = {},
  ) => {
    const diff = JSON.stringify({ version: '3.2.0', colorNotes: notes, sliders: [], bombNotes: [], obstacles: [], bpmEvents });
    return compileChart({ infoText: infoDat(opts), difficultyFiles: { 'd.dat': diff } }, 'ExpertPlus');
  };
  const compileV2Bpm = (
    notes: ReturnType<typeof note>[],
    bpmChanges: Array<{ _time: number; _BPM: number }>,
    opts: { bpm?: number } = {},
  ) => {
    const diff = JSON.stringify({ _version: '2.0.0', _notes: notes, _obstacles: [], _events: [], _customData: { _BPMChanges: bpmChanges } });
    return compileChart({ infoText: infoDat(opts), difficultyFiles: { 'd.dat': diff } }, 'ExpertPlus');
  };

  it('v3 多段積分:120→60 @beat4,beats 4/6/8 → 2.0/4.0/6.0s', () => {
    const chart = compileV3Bpm(
      [noteV3(4, 0, 1, 0), noteV3(6, 0, 1, 0), noteV3(8, 0, 1, 0)],
      [{ b: 0, m: 120 }, { b: 4, m: 60 }],
    );
    expect(chart.map((n) => n.tSec)).toEqual([2.0, 4.0, 6.0]);
  });

  it('v3 單段等於常數(不回歸):[{0,120}] 與無 bpmEvents 一致', () => {
    const withSeg = compileV3Bpm([noteV3(3, 0, 1, 0)], [{ b: 0, m: 120 }]);
    const withNone = compileV3([noteV3(3, 0, 1, 0)]);
    expect(withSeg[0]!.tSec).toBeCloseTo(1.5, 10);
    expect(withSeg[0]!.tSec).toBeCloseTo(withNone[0]!.tSec, 10);
  });

  it('v3 首事件 beat>0:其前用 info.bpm。[{4,60}]@120 → beat2=1.0s、beat6=4.0s', () => {
    const chart = compileV3Bpm([noteV3(2, 0, 1, 0), noteV3(6, 0, 1, 0)], [{ b: 4, m: 60 }]);
    expect(chart[0]!.tSec).toBeCloseTo(1.0, 10);
    expect(chart[1]!.tSec).toBeCloseTo(4.0, 10);
  });

  it('bpmEvents 凌駕 Info.dat BPM:info=128 但 [{0,120}] → beat2=1.0s(非 0.9375)', () => {
    const chart = compileV3Bpm([noteV3(2, 0, 1, 0)], [{ b: 0, m: 120 }], { bpm: 128 });
    expect(chart[0]!.tSec).toBeCloseTo(1.0, 10);
  });

  it('hold 跨越 BPM 邊界:head beat2→1.0s、tail beat6→4.0s(120→60 @beat4)', () => {
    const diff = JSON.stringify({
      version: '3.2.0',
      colorNotes: [],
      sliders: [{ c: 0, b: 2, x: 0, y: 1, tb: 6, tx: 0, ty: 1 }],
      bombNotes: [],
      obstacles: [],
      bpmEvents: [{ b: 0, m: 120 }, { b: 4, m: 60 }],
    });
    const chart = compileChart({ infoText: infoDat(), difficultyFiles: { 'd.dat': diff } }, 'ExpertPlus');
    expect(chart[0]!.kind).toBe('hold');
    expect(chart[0]!.tSec).toBeCloseTo(1.0, 10);
    expect(chart[0]!.holdEndSec).toBeCloseTo(4.0, 10);
  });

  it('v2 _customData._BPMChanges 忽略(本體不讀,等速):[{4,60}]@120 → beat6=3.0s', () => {
    // MMA2 等編輯器的顯示用欄位;已發佈 v2 譜的 _time 已在固定 Info BPM 空間,積分會算歪。見 docs/adr/0009。
    const chart = compileV2Bpm([note(6, 0, 1, 0)], [{ _time: 4, _BPM: 60 }]);
    expect(chart[0]!.tSec).toBeCloseTo(3.0, 10); // 全程 120:6×0.5
  });

  it('空 bpmEvents → 常數回退(beat3=1.5s @120)', () => {
    const chart = compileV3Bpm([noteV3(3, 0, 1, 0)], []);
    expect(chart[0]!.tSec).toBeCloseTo(1.5, 10);
  });

  it('健壯:缺 m / bpm≤0 的項被忽略,退回有效 BPM', () => {
    const chart = compileV3Bpm(
      [noteV3(6, 0, 1, 0)],
      [{ b: 0, m: 120 }, { b: 2 }, { b: 3, m: 0 }, { b: 4, m: -5 }],
    );
    expect(chart[0]!.tSec).toBeCloseTo(3.0, 10); // 全程 120:6×0.5
  });
});

describe('mapping 單元', () => {
  it('glyphOf:字母去前綴、符號查表', () => {
    expect(glyphOf('KeyF')).toBe('F');
    expect(glyphOf('Semicolon')).toBe(';');
    expect(glyphOf('Comma')).toBe(',');
    expect(glyphOf('Period')).toBe('.');
    expect(glyphOf('Slash')).toBe('/');
  });
});
