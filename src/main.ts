// 進入點:組裝 loader / compile / audio / preview,跑端到端 tracer bullet。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart } from './compile/compileChart.ts';
import { parseInfo } from './compile/parseInfo.ts';
import { startHighway } from './highway/highway.ts';
import { BuiltinChartSource } from './loader/builtin.ts';
import type { ChartSource } from './loader/types.ts';
import { renderPreview } from './preview/renderTable.ts';
import type { TypingChart } from './compile/types.ts';

const decoder = new TextDecoder('utf-8');

async function bootstrap(root: HTMLElement, source: ChartSource): Promise<void> {
  const songs = await source.listSongs();
  const song = songs[0];
  if (!song) throw new Error('來源沒有任何歌曲');

  // 1) 讀 Info.dat → 淺解析,取得 BPM / offset / 音訊檔 / 難度清單。
  const infoText = decoder.decode(await song.readFile('Info.dat'));
  const info = parseInfo(infoText);

  // 2) 選難度(01 取第一個),只讀那個難度檔(惰性)。
  const diff = info.difficulties[0]!;
  const diffText = decoder.decode(await song.readFile(diff.filename));

  // 3) 編譯成 TypingChart(純函式,唯一正規化點)。
  const chart = compileChart(
    { infoText, difficultyFiles: { [diff.filename]: diffText } },
    diff.difficulty,
  );

  // 4) 讀音訊 bytes → 交給音訊層解碼(不經 compileChart)。
  const player = new AudioPlayer();
  const audioBytes = await song.readFile(info.audioFilename);
  await player.load(audioBytes);

  // 5) 主視圖:3D 高速公路;可切換到表格預覽(開發驗證工具)。
  mountViews(root, chart, player, {
    title: `${song.title} — ${diff.characteristic} ${diff.difficulty}`,
    bpm: info.bpm,
    songTimeOffset: info.songTimeOffset,
  });
}

interface ViewDeps {
  readonly title: string;
  readonly bpm: number;
  readonly songTimeOffset: number;
}

/** 掛載高速公路 / 表格預覽,附一個切換鈕。共用同一個 player。 */
function mountViews(root: HTMLElement, chart: TypingChart, player: AudioPlayer, deps: ViewDeps): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;';
  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:10;font-family:system-ui,sans-serif;';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText =
    'font-size:13px;padding:7px 14px;cursor:pointer;border:1px solid #4a5163;border-radius:6px;background:#1b1f2a;color:#cdd3df;';
  const viewRoot = document.createElement('div');
  toolbar.appendChild(toggle);
  wrap.append(viewRoot, toolbar);
  root.replaceChildren(wrap);

  let view: 'highway' | 'preview' = 'highway';
  let cleanup: (() => void) | null = null;

  const mount = () => {
    cleanup?.();
    if (player.isPlaying) player.pause();
    if (view === 'highway') {
      toggle.textContent = '切換到表格預覽';
      cleanup = startHighway(viewRoot, chart, { title: deps.title }, player);
    } else {
      toggle.textContent = '切換到 3D 高速公路';
      cleanup = renderPreview(viewRoot, chart, deps, player);
    }
  };

  toggle.addEventListener('click', () => {
    view = view === 'highway' ? 'preview' : 'highway';
    mount();
  });
  mount();
}

const app = document.getElementById('app');
if (app) {
  bootstrap(app, new BuiltinChartSource()).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `<div style="font-family:system-ui;max-width:860px;margin:24px auto;color:#c0392b">
      <h1 style="font-size:18px">載入失敗</h1><pre style="white-space:pre-wrap">${message}</pre></div>`;
    console.error(err);
  });
}
