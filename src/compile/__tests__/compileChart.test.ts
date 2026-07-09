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
  it('v3 譜面丟出尚未支援', () => {
    const infoText = infoDat();
    const v3 = JSON.stringify({ version: '3.2.0', colorNotes: [] });
    expect(() =>
      compileChart({ infoText, difficultyFiles: { 'd.dat': v3 } }, 'ExpertPlus'),
    ).toThrow(/v3/);
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
