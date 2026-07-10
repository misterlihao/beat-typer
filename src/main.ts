// 進入點:組裝 loader / compile / audio / preview,跑端到端 tracer bullet。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart } from './compile/compileChart.ts';
import { buildDifficultyMenu, noteStats } from './compile/difficultyMenu.ts';
import { parseInfo } from './compile/parseInfo.ts';
import { startHighway } from './highway/highway.ts';
import { BsrChartSource, parseBsrCode } from './loader/bsr.ts';
import { BuiltinChartSource } from './loader/builtin.ts';
import { ZipChartSource } from './loader/zip.ts';
import type { ChartSource, SongHandle } from './loader/types.ts';
import { renderPreview } from './preview/renderTable.ts';
import type { DifficultyRef, SongInfo, TypingChart } from './compile/types.ts';

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

  // 讀 Info.dat → 淺解析(BPM / 音訊檔 / 難度清單),再進難度選擇畫面(issue 17)。
  const infoText = decoder.decode(await song.readFile('Info.dat'));
  const info = parseInfo(infoText);
  await showDifficultyScreen(root, song, info, infoText);
}

/**
 * 難度選擇畫面(issue 17):列出可玩難度(濾 Lightshow、標準序、多特性分組)+ NPS 粗估。
 * 開畫面前預讀所有可玩難度檔算 NPS 並快取,選定後直接重用(不重讀)。選定 → startSong;返回 → 著陸畫面。
 */
async function showDifficultyScreen(
  root: HTMLElement,
  song: SongHandle,
  info: SongInfo,
  infoText: string,
): Promise<void> {
  const groups = buildDifficultyMenu(info.difficulties);
  if (groups.length === 0) throw new Error('這張譜沒有可玩難度(只有燈光譜)');

  // 預讀每個可玩難度檔 → 快取文字 + NPS 粗估(NPS ≈ 音符數 ÷ 末拍秒數,常數 BPM 近似)。
  const cache = new Map<string, string>();
  const npsLabel = new Map<string, string>();
  for (const g of groups) {
    for (const d of g.difficulties) {
      try {
        const text = decoder.decode(await song.readFile(d.filename));
        cache.set(d.filename, text);
        const { count, lastBeat } = noteStats(text);
        const nps = lastBeat > 0 ? count / ((lastBeat * 60) / info.bpm) : 0;
        npsLabel.set(d.filename, nps > 0 ? `${nps.toFixed(1)} NPS` : '');
      } catch {
        npsLabel.set(d.filename, ''); // 讀失敗 → 無 NPS;真正的錯誤留待選定後編譯時暴露
      }
    }
  }

  const songName = info.songName ?? song.title;
  root.innerHTML = `
    <div style="font-family:system-ui,sans-serif;color:#cdd3df;max-width:640px;margin:10vh auto;padding:0 20px">
      <button id="bt-back" type="button"
        style="font-size:13px;padding:6px 12px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#1b1f2a;color:#cdd3df">
        ← 返回
      </button>
      <h1 id="bt-song" style="font-size:24px;margin:18px 0 4px;text-align:center"></h1>
      <p style="color:#8b93a7;margin:0 0 26px;text-align:center;font-size:13px">選擇難度</p>
      <div id="bt-groups"></div>
      <div id="bt-error" style="min-height:22px;margin-top:18px;color:#e05656;white-space:pre-wrap;text-align:center"></div>
    </div>`;
  root.querySelector<HTMLElement>('#bt-song')!.textContent = songName;
  const errorBox = root.querySelector<HTMLElement>('#bt-error')!;
  const groupsBox = root.querySelector<HTMLElement>('#bt-groups')!;

  const pick = (diff: DifficultyRef) => {
    errorBox.textContent = '';
    startSong(root, song, info, infoText, diff, cache.get(diff.filename)).catch((err: unknown) => {
      console.error(err);
      showLanding(root, err instanceof Error ? err.message : String(err));
    });
  };

  const showGroupHeader = groups.length > 1;
  for (const g of groups) {
    if (showGroupHeader) {
      const h = document.createElement('div');
      h.textContent = g.characteristic;
      h.style.cssText = 'font-size:12px;color:#8b93a7;margin:14px 0 8px;letter-spacing:1px';
      groupsBox.appendChild(h);
    }
    for (const d of g.difficulties) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;width:100%;margin:0 0 8px;' +
        'font-size:15px;padding:12px 16px;cursor:pointer;border:1px solid #4a5163;border-radius:10px;' +
        'background:#161a24;color:#cdd3df';
      const name = document.createElement('span');
      name.textContent = d.difficulty;
      const nps = document.createElement('span');
      nps.textContent = npsLabel.get(d.filename) ?? '';
      nps.style.cssText = 'color:#8b93a7;font-size:13px';
      btn.append(name, nps);
      btn.addEventListener('click', () => pick(d));
      groupsBox.appendChild(btn);
    }
  }

  root.querySelector<HTMLButtonElement>('#bt-back')!.addEventListener('click', () => showLanding(root));
}

/** 編譯選定難度 + 解碼音訊 + 封面 → 掛載高速公路。cachedDiffText 為難度畫面預讀的文字(免重讀)。 */
async function startSong(
  root: HTMLElement,
  song: SongHandle,
  info: SongInfo,
  infoText: string,
  diff: DifficultyRef,
  cachedDiffText?: string,
): Promise<void> {
  const diffText = cachedDiffText ?? decoder.decode(await song.readFile(diff.filename));

  // 編譯成 TypingChart(純函式,唯一正規化點)。
  let chart = compileChart({ infoText, difficultyFiles: { [diff.filename]: diffText } }, diff.difficulty);

  // DEV-only:?occtest 用合成譜面重現「同列上段遮下段」的遮蔽(Y/N、T/B),供 playtest 驗修正。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('occtest')) {
    chart = makeOcclusionTestChart();
  }

  // 讀音訊 bytes → 交給音訊層解碼(不經 compileChart)。
  const player = new AudioPlayer();
  const audioBytes = await song.readFile(info.audioFilename);
  try {
    await player.load(audioBytes);
  } catch {
    throw new Error('音訊檔無法解碼(可能不是支援的格式)');
  }

  // DEV-only 診斷 hook:方便在瀏覽器對齊音訊時鐘做手動/自動驗證。正式建置不掛。
  if (import.meta.env.DEV) Reflect.set(window, '__btPlayer', player);

  // 封面圖:載入新歌前 revoke 舊 URL;缺封面時 coverUrl=undefined,資訊卡改用佔位圖。
  if (currentCoverUrl) URL.revokeObjectURL(currentCoverUrl);
  currentCoverUrl = await loadCoverUrl(song, info.coverFilename);

  // 主視圖:3D 高速公路;可切換到表格預覽(開發驗證工具)。
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
      <div style="display:flex;align-items:center;gap:12px;color:#5b6274;font-size:12px;margin:22px 0 14px">
        <span style="flex:1;height:1px;background:#2a303c"></span>或用 BeatSaver 代號<span style="flex:1;height:1px;background:#2a303c"></span>
      </div>
      <div style="display:flex;gap:8px;justify-content:center">
        <input id="bt-bsr" type="text" inputmode="latin" autocomplete="off" placeholder="5277c 或 !bsr 5277c"
          style="flex:0 1 260px;font-size:14px;padding:9px 12px;border:1px solid #4a5163;border-radius:8px;background:#0f1218;color:#cdd3df" />
        <button id="bt-bsr-go" type="button"
          style="font-size:14px;padding:9px 18px;cursor:pointer;border:0;border-radius:8px;background:#2e86d6;color:#fff">
          下載
        </button>
      </div>
      <div style="margin-top:22px">
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
  const bsrInput = app.querySelector<HTMLInputElement>('#bt-bsr')!;
  const bsrGo = app.querySelector<HTMLButtonElement>('#bt-bsr-go')!;
  const errorBox = app.querySelector<HTMLElement>('#bt-error')!;
  if (errorMessage) errorBox.textContent = `載入失敗:${errorMessage}`;

  const run = (source: ChartSource, busyText = '載入中…') => {
    drop.querySelector('div')!.textContent = busyText;
    errorBox.textContent = '';
    bootstrap(app, source).catch((err: unknown) => {
      console.error(err);
      showLanding(app, err instanceof Error ? err.message : String(err));
    });
  };

  // BSR 下載:解析代號(純代號 / !bsr / URL);格式不對就地報錯,合法則下載(顯示「下載中…」)。
  const runBsr = () => {
    const code = parseBsrCode(bsrInput.value);
    if (!code) {
      errorBox.textContent = 'BSR 代號格式不對(範例:5277c 或 !bsr 5277c)';
      return;
    }
    run(new BsrChartSource(code), '下載中…');
  };
  bsrGo.addEventListener('click', runBsr);
  bsrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runBsr();
    }
  });

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
