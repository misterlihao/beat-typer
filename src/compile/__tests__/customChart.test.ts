// 自製譜面文字解析(issue 22 階段一)的純函式測試:手寫文字 fixture,斷言音符列與錯誤;
// 並經 customChartToDiffText → compileChart 驗「強調」一路流到 Note.emphasized(含疊放聯集)。
import { describe, expect, it } from 'vitest';
import { compileChart, extractBpmSegments } from '../compileChart.ts';
import { customChartToDiffText, parseCustomChart } from '../customChart.ts';

// 借真實 Info 的 BPM/難度 ref;難度檔內容由自製文字生成後覆寫。
function infoDat(bpm = 120): string {
  return JSON.stringify({
    _version: '2.0.0',
    _beatsPerMinute: bpm,
    _songTimeOffset: 0,
    _songFilename: 'song.egg',
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: 'Standard',
        _difficultyBeatmaps: [{ _difficulty: 'ExpertPlus', _beatmapFilename: 'd.dat' }],
      },
    ],
  });
}
function compileCustom(text: string, bpm = 120) {
  const diffText = customChartToDiffText(parseCustomChart(text));
  return compileChart({ infoText: infoDat(bpm), difficultyFiles: { 'd.dat': diffText } }, 'ExpertPlus');
}

describe('parseCustomChart — 合法輸入', () => {
  it('拍 / 手 / 種類 逐欄解析,L→left、R→right', () => {
    const notes = parseCustomChart('4 L press\n4.5 R press');
    expect(notes).toEqual([
      { beat: 4, hand: 'left', kind: 'press', emphasized: false },
      { beat: 4.5, hand: 'right', kind: 'press', emphasized: false },
    ]);
  });

  it('尾綴 ! = 強調(press! 與 hold! 皆可)', () => {
    const notes = parseCustomChart('4 L press!\n8 R hold! 12');
    expect(notes[0]).toMatchObject({ kind: 'press', emphasized: true });
    expect(notes[1]).toMatchObject({ kind: 'hold', emphasized: true, endBeat: 12 });
  });

  it('hold 帶結束拍', () => {
    expect(parseCustomChart('8 L hold 12')).toEqual([
      { beat: 8, hand: 'left', kind: 'hold', emphasized: false, endBeat: 12 },
    ]);
  });

  it('# 註解、空白行、行尾註解都略過', () => {
    const notes = parseCustomChart('# 標題\n\n4 L press  # 第一顆\n   \n8 R press');
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.beat)).toEqual([4, 8]);
  });

  it('手與種類不分大小寫', () => {
    const notes = parseCustomChart('4 l PRESS\n8 R Hold 10');
    expect(notes[0]).toMatchObject({ hand: 'left', kind: 'press' });
    expect(notes[1]).toMatchObject({ hand: 'right', kind: 'hold' });
  });
});

describe('parseCustomChart — 錯誤(逐行、含行號、可蒐集)', () => {
  it('拍非數字 / 負數', () => {
    expect(() => parseCustomChart('x L press')).toThrow(/第 1 行.*拍/);
    expect(() => parseCustomChart('-1 L press')).toThrow(/第 1 行.*拍/);
  });
  it('手非 L/R', () => {
    expect(() => parseCustomChart('4 X press')).toThrow(/第 1 行.*手/);
  });
  it('種類非 press/hold', () => {
    expect(() => parseCustomChart('4 L tap')).toThrow(/第 1 行.*種類/);
  });
  it('hold 缺結束拍 / 結束拍不大於起始拍', () => {
    expect(() => parseCustomChart('8 L hold')).toThrow(/第 1 行.*結束拍/);
    expect(() => parseCustomChart('8 L hold 8')).toThrow(/須大於起始拍/);
  });
  it('press 多帶結束拍 / 欄位過多', () => {
    expect(() => parseCustomChart('4 L press 6')).toThrow(/press 不該有結束拍/);
    expect(() => parseCustomChart('4 L press! extra junk')).toThrow(/欄位過多/);
  });
  it('多行錯誤一次全報(各帶行號)', () => {
    try {
      parseCustomChart('4 L press\nx R press\n8 L hold');
      expect.unreachable('應拋錯');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/第 2 行/);
      expect(msg).toMatch(/第 3 行/);
    }
  });
});

describe('自製譜面 → compileChart — 強調流到 Note.emphasized', () => {
  it('press! → emphasized:true;普通 press → false', () => {
    const chart = compileCustom('4 L press!\n8 R press');
    expect(chart[0]).toMatchObject({ kind: 'press', emphasized: true });
    expect(chart[1]).toMatchObject({ kind: 'press', emphasized: false });
  });

  it('hold! → kind hold + emphasized:true', () => {
    const [note] = compileCustom('8 L hold! 12');
    expect(note).toMatchObject({ kind: 'hold', emphasized: true });
    expect(note!.holdEndSec).toBeGreaterThan(note!.tSec);
  });

  it('拍→秒用 Info 的 BPM(120bpm:第 4 拍 = 2 秒)', () => {
    const [note] = compileCustom('4 L press');
    expect(note!.tSec).toBeCloseTo(2, 10);
  });

  it('手由顏色決定:L→左手鍵、R→右手鍵', () => {
    const chart = compileCustom('0 L press\n1 R press');
    expect(chart[0]!.hand).toBe('left');
    expect(chart[1]!.hand).toBe('right');
  });

  it('疊放收斂取強調聯集:同拍同手一普通一強調 → 收斂成一顆強調', () => {
    // 同一拍、同左手兩顆(其一強調),STACK_BEAT_THRESHOLD 內收斂成一顆。
    const chart = compileCustom('4 L press\n4 L press!');
    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({ hand: 'left', emphasized: true });
  });
});

describe('extractBpmSegments — 讀基底歌變速表(供自製譜面沿用)', () => {
  it('v3 bpmEvents → 段落', () => {
    const text = JSON.stringify({ version: '3.2.0', colorNotes: [], bpmEvents: [{ b: 0, m: 120 }, { b: 4, m: 240 }] });
    expect(extractBpmSegments(text)).toEqual([{ beat: 0, bpm: 120 }, { beat: 4, bpm: 240 }]);
  });
  it('v2 _customData._BPMChanges → 段落', () => {
    const text = JSON.stringify({ _version: '2.0.0', _notes: [], _customData: { _BPMChanges: [{ _time: 8, _BPM: 180 }] } });
    expect(extractBpmSegments(text)).toEqual([{ beat: 8, bpm: 180 }]);
  });
  it('無變速 / 壞 JSON → 空陣列', () => {
    expect(extractBpmSegments(JSON.stringify({ version: '3.2.0', colorNotes: [] }))).toEqual([]);
    expect(extractBpmSegments('not json')).toEqual([]);
  });
});

describe('自製譜面 → compileChart — 沿用基底歌變速表(issue 22 變速修正)', () => {
  it('嵌入 bpmEvents 後,自製拍以變速表換算(非常數 BPM)', () => {
    // 變速:beat0 起 120bpm、beat4 起 240bpm。第 8 拍 = 前 4 拍×0.5s + 後 4 拍×0.25s = 3s。
    // 若誤用常數 120bpm,會得 8×0.5 = 4s。
    const segments = [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 240 }];
    const diffText = customChartToDiffText(parseCustomChart('8 L press'), segments);
    const chart = compileChart({ infoText: infoDat(120), difficultyFiles: { 'd.dat': diffText } }, 'ExpertPlus');
    expect(chart[0]!.tSec).toBeCloseTo(3, 10);
  });

  it('不傳變速表 → 退回常數 BPM(第 8 拍 @120bpm = 4s)', () => {
    const chart = compileCustom('8 L press', 120);
    expect(chart[0]!.tSec).toBeCloseTo(4, 10);
  });
});
