// 進入點:組裝 loader / compile / audio / preview,跑端到端 tracer bullet。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart } from './compile/compileChart.ts';
import { parseInfo, pickPlayableDifficulty } from './compile/parseInfo.ts';
import { startHighway } from './highway/highway.ts';
import { BuiltinChartSource } from './loader/builtin.ts';
import { ZipChartSource } from './loader/zip.ts';
import type { ChartSource } from './loader/types.ts';
import { renderPreview } from './preview/renderTable.ts';
import type { TypingChart } from './compile/types.ts';

const decoder = new TextDecoder('utf-8');

// 目前這首歌的封面 object URL;載入新歌前先 revoke 舊的,避免累積洩漏。
let currentCoverUrl: string | undefined;

/** 讀封面圖 bytes → object URL;缺檔名或讀/建失敗一律回 undefined(靜默略過,改用佔位圖)。 */
async function loadCoverUrl(song: { readFile(name: string): Promise<ArrayBuffer> }, filename?: string): Promise<string | undefined> {
  if (!filename) return undefined;
  try {
    const bytes = await song.readFile(filename);
    return URL.createObjectURL(new Blob([bytes]));
  } catch {
    return undefined; // 封面缺漏不該讓遊戲載入失敗
  }
}

// DEV-only:重現同列上段遮下段的合成譜面(上段先到=較近,下段緊隨於後=較遠)。
// Y/N=右內側食指(col5 上/下)、T/B=左內側食指(col4 上/下);gap 掃過 0.15~0.5s。
function makeOcclusionTestChart(): TypingChart {
  const mk = (tSec: number, key: string, bank: 'top' | 'bottom', hand: 'left' | 'right'): TypingChart[number] => ({
    tSec,
    key,
    kind: 'press',
    hand,
    finger: 'index',
    bank,
  });
  return [
    mk(0.6, 'KeyY', 'top', 'right'),
    mk(0.78, 'KeyN', 'bottom', 'right'), // gap .18
    mk(1.4, 'KeyT', 'top', 'left'),
    mk(1.65, 'KeyB', 'bottom', 'left'), // gap .25
    mk(2.3, 'KeyY', 'top', 'right'),
    mk(2.65, 'KeyN', 'bottom', 'right'), // gap .35
    mk(3.2, 'KeyT', 'top', 'left'),
    mk(3.65, 'KeyB', 'bottom', 'left'), // gap .45
  ];
}

async function bootstrap(root: HTMLElement, source: ChartSource): Promise<void> {
  const songs = await source.listSongs();
  const song = songs[0];
  if (!song) throw new Error('來源沒有任何歌曲');

  // 1) 讀 Info.dat → 淺解析,取得 BPM / offset / 音訊檔 / 難度清單。
  const infoText = decoder.decode(await song.readFile('Info.dat'));
  const info = parseInfo(infoText);

  // 2) 選難度:略過無音符的 Lightshow、優先 Standard(難度選單留 issue 05)。只讀選定難度檔(惰性)。
  const diff = pickPlayableDifficulty(info.difficulties);
  const diffText = decoder.decode(await song.readFile(diff.filename));

  // 3) 編譯成 TypingChart(純函式,唯一正規化點)。
  let chart = compileChart(
    { infoText, difficultyFiles: { [diff.filename]: diffText } },
    diff.difficulty,
  );

  // DEV-only:?occtest 用合成譜面重現「同列上段遮下段」的遮蔽(Y/N、T/B),供 playtest 驗修正。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('occtest')) {
    chart = makeOcclusionTestChart();
  }

  // 4) 讀音訊 bytes → 交給音訊層解碼(不經 compileChart)。
  const player = new AudioPlayer();
  const audioBytes = await song.readFile(info.audioFilename);
  try {
    await player.load(audioBytes);
  } catch {
    throw new Error('音訊檔無法解碼(可能不是支援的格式)');
  }

  // DEV-only 診斷 hook:方便在瀏覽器對齊音訊時鐘做手動/自動驗證。正式建置不掛。
  if (import.meta.env.DEV) Reflect.set(window, '__btPlayer', player);

  // 5) 封面圖:載入新歌前 revoke 舊 URL;缺封面時 coverUrl=undefined,資訊卡改用佔位圖。
  if (currentCoverUrl) URL.revokeObjectURL(currentCoverUrl);
  currentCoverUrl = await loadCoverUrl(song, info.coverFilename);

  // 6) 主視圖:3D 高速公路;可切換到表格預覽(開發驗證工具)。
  //    歌名優先用 Info.dat 的 _songName(source 不 parse);缺漏才 fallback 到 SongHandle.title。
  const songName = info.songName ?? song.title;
  const difficultyLabel = `${diff.characteristic} ${diff.difficulty}`;
  mountViews(root, chart, player, {
    title: `${songName} — ${difficultyLabel}`,
    songName,
    difficultyLabel,
    coverUrl: currentCoverUrl,
    bpm: info.bpm,
    songTimeOffset: info.songTimeOffset,
  });
}

interface ViewDeps {
  readonly title: string;
  readonly songName: string;
  readonly difficultyLabel: string;
  readonly coverUrl?: string;
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
      cleanup = startHighway(
        viewRoot,
        chart,
        { songName: deps.songName, difficultyLabel: deps.difficultyLabel, coverUrl: deps.coverUrl },
        player,
      );
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

/**
 * 著陸畫面:拖放 zip / 點擊選檔 / 玩內建範例,三路都走同一個 bootstrap。
 * 載入失敗時就地顯示紅字錯誤、拖放區保留,可直接再拖下一個 zip(免重整;見 docs/adr/0007 情境)。
 */
function showLanding(app: HTMLElement, errorMessage?: string): void {
  app.innerHTML = `
    <div style="font-family:system-ui,sans-serif;color:#cdd3df;max-width:640px;margin:12vh auto;padding:0 20px;text-align:center">
      <h1 style="font-size:28px;letter-spacing:1px;margin:0 0 6px">Beat Typer</h1>
      <p style="color:#8b93a7;margin:0 0 28px">把 Beat Saber 譜面變成節奏打字練習</p>
      <label id="bt-drop" for="bt-file" tabindex="0"
        style="display:block;border:2px dashed #4a5163;border-radius:12px;padding:44px 20px;cursor:pointer;background:#161a24;transition:border-color .15s,background .15s">
        <div style="font-size:16px;color:#cdd3df">把 BeatSaver <b>.zip</b> 拖進來</div>
        <div style="font-size:13px;color:#8b93a7;margin-top:6px">或點此選擇檔案</div>
      </label>
      <div style="margin-top:18px">
        <button id="bt-sample" type="button"
          style="font-size:14px;padding:9px 18px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#1b1f2a;color:#cdd3df">
          玩內建範例
        </button>
      </div>
      <div id="bt-error" style="min-height:22px;margin-top:18px;color:#e05656;white-space:pre-wrap"></div>
      <input id="bt-file" type="file" accept=".zip"
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);border:0" />
    </div>`;

  const drop = app.querySelector<HTMLElement>('#bt-drop')!;
  const fileInput = app.querySelector<HTMLInputElement>('#bt-file')!;
  const sampleBtn = app.querySelector<HTMLButtonElement>('#bt-sample')!;
  const errorBox = app.querySelector<HTMLElement>('#bt-error')!;
  if (errorMessage) errorBox.textContent = `載入失敗:${errorMessage}`;

  const setBusy = () => {
    drop.querySelector('div')!.textContent = '載入中…';
    errorBox.textContent = '';
  };
  const run = (source: ChartSource) => {
    setBusy();
    bootstrap(app, source).catch((err: unknown) => {
      console.error(err);
      showLanding(app, err instanceof Error ? err.message : String(err));
    });
  };

  // 滑鼠點擊由 <label for> 原生開啟選檔視窗(不靠 programmatic click,跨瀏覽器可靠);
  // 鍵盤(label 不會原生回應 Enter/Space)才走 JS 觸發。
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) run(new ZipChartSource(file, file.name));
  });
  sampleBtn.addEventListener('click', () => run(new BuiltinChartSource()));

  const highlight = (on: boolean) => {
    drop.style.borderColor = on ? '#6ea8fe' : '#4a5163';
    drop.style.background = on ? '#1a2332' : '#161a24';
  };
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    highlight(true);
  });
  drop.addEventListener('dragleave', () => highlight(false));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    highlight(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) run(new ZipChartSource(file, file.name));
  });
}

// 防呆:拖到拖放區以外時,別讓瀏覽器把 zip 當網址開掉。
for (const ev of ['dragover', 'drop'] as const) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

const app = document.getElementById('app');
if (app) showLanding(app);
