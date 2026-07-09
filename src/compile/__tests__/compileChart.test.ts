// compileChart 的主要測試:手寫 inline v2 fixture,斷言固定輸出。
// 這是專案第一批測試,立下「純函式 + fixtures」慣例(後續 issue 沿用擴充)。
import { describe, expect, it } from 'vitest';
import { compileChart } from '../compileChart.ts';
import { glyphOf, mapNote } from '../mapping.ts';

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

describe('compileChart — 映射', () => {
  it('紅音符 col2/layer0 → 左手中指下排 KeyC', () => {
    const [n] = compile([note(0, 2, 0, 0)]);
    expect(n).toMatchObject({ key: 'KeyC', hand: 'left', finger: 'middle', bank: 'bottom', kind: 'press' });
  });

  it('藍音符 col0/layer2 → 右手食指上排 KeyU(空間順序:右食指在內側)', () => {
    const [n] = compile([note(0, 0, 2, 1)]);
    expect(n).toMatchObject({ key: 'KeyU', hand: 'right', finger: 'index', bank: 'top' });
  });

  it('藍音符 col3/layer1 → 右手小指家排 Semicolon', () => {
    const [n] = compile([note(0, 3, 1, 1)]);
    expect(n).toMatchObject({ key: 'Semicolon', hand: 'right', finger: 'pinky', bank: 'home' });
  });

  it('紅音符 col1/layer2 → 左手無名上排 KeyW', () => {
    const [n] = compile([note(0, 1, 2, 0)]);
    expect(n).toMatchObject({ key: 'KeyW', hand: 'left', finger: 'ring', bank: 'top' });
  });
});

describe('compileChart — beat→秒換算', () => {
  it('BPM 120、offset 0.05:beat 2 → tSec 1.05', () => {
    const [n] = compile([note(2, 0, 1, 0)], { bpm: 120, offset: 0.05 });
    expect(n.tSec).toBeCloseTo(1.05, 10);
  });

  it('BPM 60、offset 0:beat 1 → tSec 1.0', () => {
    const [n] = compile([note(1, 0, 1, 0)], { bpm: 60, offset: 0 });
    expect(n.tSec).toBeCloseTo(1.0, 10);
  });

  it('offset 為負也生效', () => {
    const [n] = compile([note(0, 0, 1, 0)], { bpm: 120, offset: -0.1 });
    expect(n.tSec).toBeCloseTo(-0.1, 10);
  });
});

describe('compileChart — 過濾與排序', () => {
  it('炸彈(type 3)與其他非紅藍音符被濾除', () => {
    const chart = compile([note(0, 0, 0, 3), note(1, 0, 1, 0), note(2, 0, 0, 5)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]!.key).toBe('KeyA');
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

// PRD 全格映射表(顏色→欄→[下排,家排,上排])。golden 期望值,獨立於實作。
const EXPECTED_GRID: Record<number, Record<number, readonly [string, string, string]>> = {
  0: {
    // 紅=左手
    0: ['KeyZ', 'KeyA', 'KeyQ'], // 左小指
    1: ['KeyX', 'KeyS', 'KeyW'], // 左無名
    2: ['KeyC', 'KeyD', 'KeyE'], // 左中指
    3: ['KeyV', 'KeyF', 'KeyR'], // 左食指
  },
  1: {
    // 藍=右手(欄鏡射:col0 對右食指、col3 對右小指)
    0: ['KeyM', 'KeyJ', 'KeyU'], // 右食指
    1: ['Comma', 'KeyK', 'KeyI'], // 右中指
    2: ['Period', 'KeyL', 'KeyO'], // 右無名
    3: ['Slash', 'Semicolon', 'KeyP'], // 右小指
  },
};

describe('compileChart — v3 全格映射(每一格一個 fixture)', () => {
  for (const color of [0, 1]) {
    for (const column of [0, 1, 2, 3]) {
      for (const layer of [0, 1, 2]) {
        const expectedKey = EXPECTED_GRID[color]![column]![layer]!;
        it(`v3 c${color}/x${column}/y${layer} → ${expectedKey}`, () => {
          const [n] = compileV3([noteV3(0, column, layer, color)]);
          expect(n!.key).toBe(expectedKey);
        });
      }
    }
  }
});

describe('compileChart — v2↔v3 對等', () => {
  it('同一批邏輯音符,v2 與 v3 產出完全一致的 TypingChart', () => {
    // [time/beat, 欄, 列, 顏色] — 跨手、跨欄、跨列、含右手鏡射與同拍
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

describe('compileChart — v3 beat→秒換算', () => {
  it('v3 BPM 120、offset 0.05:beat 2 → tSec 1.05', () => {
    const [n] = compileV3([noteV3(2, 0, 1, 0)], { bpm: 120, offset: 0.05 });
    expect(n!.tSec).toBeCloseTo(1.05, 10);
  });

  it('v3 BPM 60、offset 0:beat 1 → tSec 1.0', () => {
    const [n] = compileV3([noteV3(1, 0, 1, 0)], { bpm: 60, offset: 0 });
    expect(n!.tSec).toBeCloseTo(1.0, 10);
  });

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
    expect(chart[0]!.key).toBe('KeyA');
  });
});

describe('compileChart — 同手疊放收斂(< 1/8 beat → 單一內側鍵)', () => {
  // BPM 120 → secPerBeat 0.5;1/8 beat = 0.125 beat = 0.0625s。
  it('同手兩顆相距 < 1/8 beat → 收斂成一顆內側鍵,列取錨點', () => {
    // 左手 beat0(col0/row1=KeyA)+ beat0.1(col1/row1);錨點列=1(家)→ 左內側家鍵 KeyG。
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0.1, 1, 1, 0)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({
      key: 'KeyG',
      hand: 'left',
      finger: 'index',
      bank: 'home',
      kind: 'press',
      tSec: 0,
    });
  });

  it('右手疊放 → 右內側鍵(錨點列決定上中下)', () => {
    // 右手 beat0(col0/row2=上)+ beat0.05(col1/row0);錨點列=2(上)→ 右內側上鍵 KeyY。
    const chart = compileV3([noteV3(0, 0, 2, 1), noteV3(0.05, 1, 0, 1)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ key: 'KeyY', hand: 'right', finger: 'index', bank: 'top' });
  });

  it('錨點制:beat 0/0.1/0.2 → {0,0.1} 疊放、{0.2} 單顆,不鏈式串接', () => {
    const chart = compileV3([
      noteV3(0, 0, 1, 0), // 錨點
      noteV3(0.1, 1, 1, 0), // 併入(0.1 < 0.125)
      noteV3(0.2, 2, 0, 0), // 距錨點 0.2 ≥ 0.125 → 自成一群(col2/row0=KeyC)
    ]);
    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ key: 'KeyG', tSec: 0 }); // 疊放收斂
    expect(chart[1]).toMatchObject({ key: 'KeyC', tSec: 0.1 }); // 單顆正常映射
  });

  it('恰好相距 1/8 beat → 連打(各自保留),非疊放', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0.125, 0, 1, 0)]);
    expect(chart).toHaveLength(2);
    expect(chart.every((n) => n.key === 'KeyA')).toBe(true);
  });

  it('跨手同拍 → 兩顆各自保留、共用 tSec,不收斂', () => {
    const chart = compileV3([noteV3(0, 0, 1, 0), noteV3(0, 1, 1, 1)]);
    expect(chart).toHaveLength(2);
    expect(chart.map((n) => n.key).sort()).toEqual(['KeyA', 'KeyK']);
    expect(chart.every((n) => n.tSec === 0)).toBe(true);
  });

  it('v2 疊放同樣收斂(行為與格式無關)', () => {
    const chart = compile([note(0, 0, 1, 0), note(0, 1, 1, 0)]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ key: 'KeyG', hand: 'left', finger: 'index' });
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

  it('弧線輸出 kind:hold、key 取 head、holdEndSec 取 tail', () => {
    // head col0/row1/紅 = 左小指家 KeyA;tail beat 2 → holdEndSec 1.0(BPM120)。
    const chart = compileSliders([], [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }]);
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ key: 'KeyA', kind: 'hold', tSec: 0 });
    expect(chart[0]!.holdEndSec).toBeCloseTo(1.0, 10);
  });

  it('與 head 精確重疊的 colorNote 被濾除(不 press+hold 並存)', () => {
    const chart = compileSliders(
      [noteV3(0, 0, 1, 0), noteV3(1, 1, 1, 1)], // 第一顆與 head 重疊 → 濾除;第二顆保留
      [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }],
    );
    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ key: 'KeyA', kind: 'hold' });
    expect(chart[1]).toMatchObject({ key: 'KeyK', kind: 'press' }); // col1/row1/藍 = 右中指家
  });

  it('與 tail 精確重疊的 colorNote 也被濾除', () => {
    const chart = compileSliders(
      [noteV3(2, 0, 1, 0)], // 與 tail(beat2,col0,row1,紅)重疊 → 濾除
      [{ c: 0, b: 0, x: 0, y: 1, tb: 2, tx: 0, ty: 1 }],
    );
    expect(chart).toHaveLength(1);
    expect(chart[0]!.kind).toBe('hold');
  });
});

describe('mapping 單元', () => {
  it('mapNote 涵蓋四角落', () => {
    expect(mapNote(0, 0, 2)).toMatchObject({ key: 'KeyQ' }); // 左小指上
    expect(mapNote(0, 3, 0)).toMatchObject({ key: 'KeyV' }); // 左食指下
    expect(mapNote(1, 0, 0)).toMatchObject({ key: 'KeyM' }); // 右食指下
    expect(mapNote(1, 3, 2)).toMatchObject({ key: 'KeyP' }); // 右小指上
  });

  it('glyphOf:字母去前綴、符號查表', () => {
    expect(glyphOf('KeyF')).toBe('F');
    expect(glyphOf('Semicolon')).toBe(';');
    expect(glyphOf('Comma')).toBe(',');
    expect(glyphOf('Period')).toBe('.');
    expect(glyphOf('Slash')).toBe('/');
  });
});
