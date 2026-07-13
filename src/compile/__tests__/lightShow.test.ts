// compileLightShow 的測試:手寫最小 inline fixture,斷言標準化燈光時間線的各分支。
// 涵蓋:v2 `_events` + v3 `basicBeatmapEvents` 解析、顏色鏈(Chroma > env 覆寫 > 預設淡紅藍)、
// 色燈組計數(排除旋轉/轉速)、四動作、無事件/不支援 → 空、時間對齊(offset + 變速)、lightID 收斂。
import { describe, expect, it } from 'vitest';
import { compileLightShow } from '../lightShow.ts';

// ── Info fixture(可帶每難度 env 覆寫)──
function infoDat(opts: { bpm?: number; offset?: number; env?: Record<string, unknown> } = {}): string {
  return JSON.stringify({
    _version: '2.0.0',
    _beatsPerMinute: opts.bpm ?? 120,
    _songTimeOffset: opts.offset ?? 0,
    _songFilename: 'song.egg',
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: 'Standard',
        _difficultyBeatmaps: [
          { _difficulty: 'ExpertPlus', _beatmapFilename: 'd.dat', _customData: opts.env ?? {} },
        ],
      },
    ],
  });
}

// ── v2 `_events` fixture ──
function v2Event(time: number, type: number, value: number, extra: Record<string, unknown> = {}) {
  return { _time: time, _type: type, _value: value, _floatValue: 1, ...extra };
}
function diffV2(events: object[]): string {
  return JSON.stringify({ _version: '2.0.0', _notes: [], _obstacles: [], _events: events });
}
function compileV2(events: object[], opts: Parameters<typeof infoDat>[0] = {}) {
  return compileLightShow(
    { infoText: infoDat(opts), difficultyFiles: { 'd.dat': diffV2(events) } },
    'ExpertPlus',
  );
}

// ── v3 `basicBeatmapEvents` fixture ──
function v3Event(b: number, et: number, i: number, extra: Record<string, unknown> = {}) {
  return { b, et, i, f: 1, ...extra };
}
function diffV3(events: object[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: '3.2.0', colorNotes: [], basicBeatmapEvents: events, ...extra });
}
function compileV3(events: object[], opts: Parameters<typeof infoDat>[0] = {}, extra: Record<string, unknown> = {}) {
  return compileLightShow(
    { infoText: infoDat(opts), difficultyFiles: { 'd.dat': diffV3(events, extra) } },
    'ExpertPlus',
  );
}

describe('compileLightShow — 格式解析', () => {
  it('解析 v2 `_events`,回帶時間/組/動作的事件', () => {
    const show = compileV2([v2Event(0, 1, 1)]); // beat 0, 環燈, 藍 on
    expect(show).toHaveLength(1);
    expect(show[0]!.group).toBe(1);
    expect(show[0]!.action).toBe('on');
    expect(show[0]!.tSec).toBeCloseTo(0);
  });

  it('解析 v3 `basicBeatmapEvents`', () => {
    const show = compileV3([v3Event(2, 0, 1)]); // beat 2 @120bpm = 1s
    expect(show).toHaveLength(1);
    expect(show[0]!.group).toBe(0);
    expect(show[0]!.tSec).toBeCloseTo(1);
  });

  it('無事件 / 空陣列 / 不支援版本 → 空時間線', () => {
    expect(compileV2([])).toEqual([]);
    expect(compileLightShow({ infoText: infoDat(), difficultyFiles: { 'd.dat': '{"_version":"9"}' } }, 'ExpertPlus')).toEqual([]);
    expect(compileLightShow({ infoText: infoDat(), difficultyFiles: {} }, 'ExpertPlus')).toEqual([]);
    expect(compileLightShow({ infoText: infoDat(), difficultyFiles: { 'd.dat': 'not json' } }, 'ExpertPlus')).toEqual([]);
  });

  it('找不到難度 → 空時間線', () => {
    expect(compileV2([v2Event(0, 1, 1)], {}).length).toBe(1);
    expect(
      compileLightShow({ infoText: infoDat(), difficultyFiles: { 'd.dat': diffV2([v2Event(0, 1, 1)]) } }, 'Nope'),
    ).toEqual([]);
  });
});

describe('compileLightShow — 動作解碼', () => {
  it('值 → off/on/flash/fade', () => {
    const [off] = compileV2([v2Event(0, 1, 0)]);
    // 0=off 事件仍保留(sink 用它熄燈),brightness=0
    expect(off!.action).toBe('off');
    expect(off!.brightness).toBe(0);
    expect(compileV2([v2Event(0, 1, 1)])[0]!.action).toBe('on'); // 藍 on
    expect(compileV2([v2Event(0, 1, 2)])[0]!.action).toBe('flash'); // 藍 flash
    expect(compileV2([v2Event(0, 1, 3)])[0]!.action).toBe('fade'); // 藍 fade
    expect(compileV2([v2Event(0, 1, 5)])[0]!.action).toBe('on'); // 紅 on
    expect(compileV2([v2Event(0, 1, 6)])[0]!.action).toBe('flash'); // 紅 flash
    expect(compileV2([v2Event(0, 1, 7)])[0]!.action).toBe('fade'); // 紅 fade
  });

  it('brightness = floatValue × Chroma alpha,夾 [0,2]', () => {
    const [half] = compileV2([v2Event(0, 1, 1, { _floatValue: 0.5 })]);
    expect(half!.brightness).toBeCloseTo(0.5);
    // Chroma alpha 3(HDR)× float 1 → 夾到 2
    const [hdr] = compileV2([v2Event(0, 1, 1, { _customData: { _color: [1, 0, 0, 3] } })]);
    expect(hdr!.brightness).toBe(2);
  });
});

describe('compileLightShow — 色燈組計數(排除旋轉/轉速)', () => {
  it('排除 et 5/8/9/12/13(boost/旋轉/轉速),只留色燈組', () => {
    const show = compileV2([
      v2Event(0, 0, 1), // 色燈組
      v2Event(0, 2, 1), // 色燈組
      v2Event(0, 8, 1), // 環旋轉 → 排除
      v2Event(0, 12, 1), // 雷射轉速 → 排除
      v2Event(0, 5, 1), // 色 boost → 排除
    ]);
    const groups = new Set(show.map((e) => e.group));
    expect([...groups].sort((a, b) => a - b)).toEqual([0, 2]);
  });
});

describe('compileLightShow — 顏色鏈', () => {
  const isRed = (c: { r: number; g: number; b: number }) => c.r > c.b;
  const isBlue = (c: { r: number; g: number; b: number }) => c.b > c.r;

  it('無指定 → 預設淡紅藍(紅碼偏紅、藍碼偏藍)', () => {
    expect(isRed(compileV2([v2Event(0, 1, 5)])[0]!.color)).toBe(true); // 紅碼
    expect(isBlue(compileV2([v2Event(0, 1, 1)])[0]!.color)).toBe(true); // 藍碼
  });

  it('env 覆寫優先於預設', () => {
    const env = { _envColorLeft: { r: 0.1, g: 0.9, b: 0.2 }, _envColorRight: { r: 0.9, g: 0.1, b: 0.1 } };
    // 紅碼(左)→ 取 envColorLeft(這裡被覆寫成綠)
    const [red] = compileV2([v2Event(0, 1, 5)], { env });
    expect(red!.color).toEqual({ r: 0.1, g: 0.9, b: 0.2 });
    // 藍碼(右)→ 取 envColorRight
    const [blue] = compileV2([v2Event(0, 1, 1)], { env });
    expect(blue!.color).toEqual({ r: 0.9, g: 0.1, b: 0.1 });
  });

  it('逐事件 Chroma 凌駕 env 與預設', () => {
    const env = { _envColorLeft: { r: 0.1, g: 0.9, b: 0.2 } };
    const [ev] = compileV2([v2Event(0, 1, 5, { _customData: { _color: [1, 1, 1, 1] } })], { env });
    expect(ev!.color).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('v3 Chroma 用 `customData.color`', () => {
    const [ev] = compileV3([v3Event(0, 1, 1, { customData: { color: [0.2, 0.4, 0.8] } })]);
    expect(ev!.color).toEqual({ r: 0.2, g: 0.4, b: 0.8 });
  });
});

describe('compileLightShow — 時間對齊', () => {
  it('tSec 含 songTimeOffset', () => {
    const [ev] = compileV2([v2Event(4, 1, 1)], { offset: 0.5 }); // beat4@120 = 2s + 0.5
    expect(ev!.tSec).toBeCloseTo(2.5);
  });

  it('v3 變速(bpmEvents)影響落點', () => {
    // 前 4 拍 @60bpm(每拍 1s),之後 @120bpm(每拍 0.5s)。beat 6 = 4s + 2拍×0.5 = 5s。
    const show = compileV3([v3Event(6, 1, 1)], { bpm: 60 }, { bpmEvents: [{ b: 4, m: 120 }] });
    expect(show[0]!.tSec).toBeCloseTo(5);
  });

  it('依 tSec 遞增排序', () => {
    const show = compileV2([v2Event(4, 1, 1), v2Event(0, 1, 1), v2Event(2, 1, 1)]);
    expect(show.map((e) => e.tSec)).toEqual([0, 1, 2]);
  });
});

describe('compileLightShow — lightID 收斂', () => {
  it('同時刻同組多筆(lightID 展開)只留最後一筆', () => {
    const show = compileV2([
      v2Event(0, 1, 1, { _customData: { _lightID: [1, 2], _color: [1, 0, 0, 1] } }),
      v2Event(0, 1, 1, { _customData: { _lightID: [3, 4], _color: [0, 0, 1, 1] } }),
    ]);
    expect(show).toHaveLength(1);
    expect(show[0]!.color).toEqual({ r: 0, g: 0, b: 1 }); // 最後一筆
  });
});
