// Golden 測試:編譯「真正出貨的」內建範例(public/sample/),斷言整條 TypingChart。
// 守住範例資產本身 + 端到端編譯路徑;範例被誤改會被抓到。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileChart } from '../compileChart.ts';
import { parseInfo } from '../parseInfo.ts';

const sampleDir = join(dirname(fileURLToPath(import.meta.url)), '../../../public/sample');
const read = (name: string) => readFileSync(join(sampleDir, name), 'utf-8');

describe('golden — 內建範例', () => {
  const infoText = read('Info.dat');
  const info = parseInfo(infoText);
  const diff = info.difficulties[0]!;
  const chart = compileChart(
    { infoText, difficultyFiles: { [diff.filename]: read(diff.filename) } },
    diff.difficulty,
  );

  it('parseInfo 取得正確的 BPM / offset / 音訊檔 / 難度', () => {
    expect(info.bpm).toBe(120);
    expect(info.songTimeOffset).toBeCloseTo(0.05, 10);
    expect(info.audioFilename).toBe('song.egg');
    expect(diff).toMatchObject({ characteristic: 'Standard', difficulty: 'ExpertPlus' });
  });

  it('編譯出 8 顆音符,紅藍各半;鍵由鍵指派依教學權重選(食指/中指家排+上排先)', () => {
    // 8 顆等距 0.5s(≫ 可玩性 gap 0.12),純教學權重驅動:每手前 4 顆落最高權重的
    // 食指/中指、家排優先再上排(見 docs/adr/0008)。與舊的位置映射無關。
    const expected = [
      { tSec: 0.05, key: 'KeyF', hand: 'left', finger: 'index', bank: 'home' },
      { tSec: 0.55, key: 'KeyD', hand: 'left', finger: 'middle', bank: 'home' },
      { tSec: 1.05, key: 'KeyR', hand: 'left', finger: 'index', bank: 'top' },
      { tSec: 1.55, key: 'KeyE', hand: 'left', finger: 'middle', bank: 'top' },
      { tSec: 2.05, key: 'KeyJ', hand: 'right', finger: 'index', bank: 'home' },
      { tSec: 2.55, key: 'KeyK', hand: 'right', finger: 'middle', bank: 'home' },
      { tSec: 3.05, key: 'KeyU', hand: 'right', finger: 'index', bank: 'top' },
      { tSec: 3.55, key: 'KeyI', hand: 'right', finger: 'middle', bank: 'top' },
    ];
    expect(chart).toHaveLength(expected.length);
    chart.forEach((n, i) => {
      const e = expected[i]!;
      expect(n.tSec).toBeCloseTo(e.tSec, 10);
      expect(n).toMatchObject({ key: e.key, hand: e.hand, finger: e.finger, bank: e.bank, kind: 'press' });
    });
    // 紅藍各半。
    expect(chart.filter((n) => n.hand === 'left')).toHaveLength(4);
    expect(chart.filter((n) => n.hand === 'right')).toHaveLength(4);
  });
});
