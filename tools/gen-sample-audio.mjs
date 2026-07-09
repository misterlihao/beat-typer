// 產生內建範例的合成旋律音訊 public/sample/song.egg(OGG Vorbis)。
//
// 每個音的起點精準落在範例譜面每顆音符的 tSec 上,
// 因此「音訊 vs 按鍵時間點」的對拍由建構方式保證(見 docs/adr/0001)。
//
// 依賴開發機的 ffmpeg(--enable-libvorbis)。用法:npm run gen:audio
//
// 譜面:BPM 120(每拍 0.5s)、_songTimeOffset 0.05、8 顆音符位於 beat 0..7。
// tSec = beat * 0.5 + 0.05  →  0.05, 0.55, 1.05, ... 3.55
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'sample', 'song.egg');

const BPM = 120;
const OFFSET = 0.05;
const TONE = 0.25; // 每個音的持續秒數(不重疊:每拍 0.5s)
const COUNT = 8;

// C 大調上行音階,呼應 8 顆音符
const FREQS = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];

const notes = Array.from({ length: COUNT }, (_, i) => ({
  tSec: +(i * (60 / BPM) + OFFSET).toFixed(3),
  freq: FREQS[i],
}));

const totalSec = +(notes[COUNT - 1].tSec + TONE + 0.2).toFixed(3);

// 每個音:0.25s 正弦 → 淡入淡出(去除爆音)→ adelay 移到 tSec;最後 amix 疊起來。
const inputs = [];
const filters = [];
notes.forEach((n, i) => {
  inputs.push('-f', 'lavfi', '-i', `sine=frequency=${n.freq}:duration=${TONE}`);
  const ms = Math.round(n.tSec * 1000);
  filters.push(
    `[${i}]afade=t=in:st=0:d=0.01,afade=t=out:st=${TONE - 0.01}:d=0.01,` +
      `volume=0.6,adelay=${ms}[a${i}]`,
  );
});
const mixIn = notes.map((_, i) => `[a${i}]`).join('');
const filterComplex =
  filters.join(';') +
  `;${mixIn}amix=inputs=${COUNT}:normalize=0,apad=whole_dur=${totalSec},atrim=0:${totalSec}[mix]`;

const args = [
  '-hide_banner',
  '-y',
  ...inputs,
  '-filter_complex',
  filterComplex,
  '-map',
  '[mix]',
  '-c:a',
  'libvorbis',
  '-q:a',
  '4',
  '-f',
  'ogg', // .egg 副檔名無法被 ffmpeg 自動辨識,明指 ogg 容器
  out,
];

console.log('ffmpeg 產生範例音訊 →', out);
execFileSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`完成:${totalSec}s、${COUNT} 個音,起點 tSec =`, notes.map((n) => n.tSec).join(', '));
