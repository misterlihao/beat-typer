// 進入點(流程編排層):決定該顯示哪個畫面、資料如何在畫面間流轉,組裝 loader / compile / audio / preview。
// 畫面的 DOM 渲染與互動事件在 src/screens/(landingScreen / difficultyScreen)——見 docs/adr/0014。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart } from './compile/compileChart.ts';
import { compileLightShow, type LightShow } from './compile/lightShow.ts';
import { buildDifficultyMenu, noteStats } from './compile/difficultyMenu.ts';
import { difficultyLabel, parseInfo } from './compile/parseInfo.ts';
import { startHighway, type ResultsBest } from './highway/highway.ts';
import type { JudgeSummary } from './judge/types.ts';
import { adjustedAccuracy, loadScores, recordRun, songKey } from './scores/scores.ts';
import { BsrChartSource } from './loader/bsr.ts';
import { recordRecentBsr } from './loader/recentBsr.ts';
import type { ChartSource, SongHandle } from './loader/types.ts';
import { renderPreview } from './preview/renderTable.ts';
import type { DifficultyRef, SongInfo, TypingChart } from './compile/types.ts';
import { loadSettings, patchSettings } from './settings/settings.ts';
import {
  KEY_GROUP_LABELS,
  renderDifficultyScreen,
  type DifficultyBestLabel,
} from './screens/difficultyScreen.ts';
import { renderLandingScreen } from './screens/landingScreen.ts';

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

// DEV-only:?holdtest 合成含長按的譜面,供 playtest 驗長按判定/回饋(issue 08)。
// A(KeyF)撐住 → 鎖定;B(KeyJ)提早放開 → 破。時間落在內建範例音訊(~4s)內。
function makeHoldTestChart(): TypingChart {
  return [
    { tSec: 0.6, key: 'KeyF', kind: 'hold', holdEndSec: 2.0, hand: 'left', finger: 'index', bank: 'home' },
    { tSec: 2.5, key: 'KeyJ', kind: 'hold', holdEndSec: 3.6, hand: 'right', finger: 'index', bank: 'home' },
  ];
}

async function bootstrap(root: HTMLElement, source: ChartSource): Promise<void> {
  const songs = await source.listSongs();
  const song = songs[0];
  if (!song) throw new Error('來源沒有任何歌曲');

  // 讀 Info.dat → 淺解析(BPM / 音訊檔 / 難度清單),再進難度選擇畫面(issue 17)。
  const infoText = decoder.decode(await song.readFile('Info.dat'));
  const info = parseInfo(infoText);
  // BSR 成功載入(進到難度畫面)→ 記入「最近遊玩」清單,供著陸畫面一鍵重開(issue 19 切片)。
  if (source instanceof BsrChartSource) {
    recordRecentBsr(source.code, info.songName ?? song.title);
  }
  await showDifficultyScreen(root, song, info, infoText);
}

/**
 * 難度選擇畫面(issue 17)的流程編排:預讀所有可玩難度檔算 WPM + 過去最佳並快取,
 * 交給 renderDifficultyScreen 渲染;選定後直接重用快取文字(不重讀)。選定 → startSong;返回 → 著陸畫面。
 */
async function showDifficultyScreen(
  root: HTMLElement,
  song: SongHandle,
  info: SongInfo,
  infoText: string,
): Promise<void> {
  const groups = buildDifficultyMenu(info.difficulties);
  if (groups.length === 0) throw new Error('這張譜沒有可玩難度(只有燈光譜)');

  // 預讀每個可玩難度檔 → 快取文字(startSong 免重讀)+ 打字速度粗估 + 過去最佳成績。
  // NPS ≈ 音符數 ÷ 末拍秒數(常數 BPM 近似);每顆音符 = 一次敲鍵、5 鍵 = 1 詞 → WPM = NPS × 60 ÷ 5 = NPS × 12。
  const cache = new Map<string, string>();
  const wpmLabel = new Map<string, string>();
  const bestLabel = new Map<string, DifficultyBestLabel>();
  const scores = loadScores();
  for (const g of groups) {
    for (const d of g.difficulties) {
      try {
        const text = decoder.decode(await song.readFile(d.filename));
        cache.set(d.filename, text);
        const { count, lastBeat } = noteStats(text);
        const nps = lastBeat > 0 ? count / ((lastBeat * 60) / info.bpm) : 0;
        wpmLabel.set(d.filename, nps > 0 ? `${Math.round(nps * 12)} WPM` : '');
        const rec = scores.records[songKey(text)];
        if (rec) {
          bestLabel.set(d.filename, {
            pct: `${(adjustedAccuracy(rec.bestRawAccuracy, rec.bestKeyGroup) * 100).toFixed(1)}%`,
            keyGroupLabel: KEY_GROUP_LABELS[rec.bestKeyGroup],
          });
        }
      } catch {
        wpmLabel.set(d.filename, ''); // 讀失敗 → 無 WPM;真正的錯誤留待選定後編譯時暴露
      }
    }
  }

  renderDifficultyScreen(root, {
    songName: info.songName ?? song.title,
    groups,
    wpmLabel,
    bestLabel,
    initialKeyGroup: loadSettings().keyGroup,
    onKeyGroupChange: (keyGroup) => patchSettings({ keyGroup }), // 跨場持久化(issue 12 設定層)
    onPick: (diff) => {
      startSong(root, song, info, infoText, diff, cache.get(diff.filename)).catch((err: unknown) => {
        console.error(err);
        showLanding(root, err instanceof Error ? err.message : String(err));
      });
    },
    onBack: () => showLanding(root),
  });
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

  // 編譯成 TypingChart(純函式,唯一正規化點)。鍵群為跨場偏好,編譯前由設定層讀回(issue 15)。
  // 難度以「身分」(特性 + 難度名)指定 —— 傳整個 ref,不可只傳難度名(會撞同名的其他特性,見 GitHub issue #4)。
  const keyGroup = loadSettings().keyGroup;
  const rawFiles = { infoText, difficultyFiles: { [diff.filename]: diffText } };
  let chart = compileChart(rawFiles, diff, { keyGroup });
  // 譜面燈光 → 標準化時間線(issue 24);與音符正交、獨立純函式。無燈光 → 空陣列,highway 退化為呼吸。
  const lightShow = compileLightShow(rawFiles, diff);

  // DEV-only:?occtest / ?holdtest 用合成譜面覆寫(供 playtest);覆寫時不寫入成績(身分會對不上)。
  const params = new URLSearchParams(location.search);
  const devOverride = import.meta.env.DEV && (params.has('occtest') || params.has('holdtest'));
  // ?auto(或 ?autoplay):自動演奏。純展示,不寫入成績(否則會用完美分數污染最佳紀錄)。
  const autoPlay = params.has('auto') || params.has('autoplay');
  if (import.meta.env.DEV && params.has('occtest')) {
    chart = makeOcclusionTestChart();
  }
  if (import.meta.env.DEV && params.has('holdtest')) {
    chart = makeHoldTestChart();
  }

  // 完賽寫入成績(issue 18):以難度檔身分 + 當前鍵群記錄,回傳顯示就緒的最佳。DEV 覆寫譜面 / 自動演奏不記。
  const onComplete = devOverride || autoPlay
    ? undefined
    : (summary: JudgeSummary): ResultsBest => {
        const { record, improved } = recordRun(diffText, {
          rawAccuracy: summary.accuracy,
          keyGroup,
          maxCombo: summary.maxCombo,
          fullCombo: summary.fullCombo,
        });
        return {
          adjustedAccuracyPct: `${(adjustedAccuracy(record.bestRawAccuracy, record.bestKeyGroup) * 100).toFixed(1)}%`,
          keyGroupLabel: KEY_GROUP_LABELS[record.bestKeyGroup],
          improved,
        };
      };

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
  const diffLabel = difficultyLabel(diff); // 與編譯錯誤訊息共用同一種寫法(特性 + 難度名)
  mountViews(root, chart, player, {
    title: `${songName} — ${diffLabel}`,
    songName,
    difficultyLabel: diffLabel,
    coverUrl: currentCoverUrl,
    lightShow, // 譜面燈光(issue 24);透傳給高速公路的燈光 rig
    bpm: info.bpm,
    songTimeOffset: info.songTimeOffset,
    onExit: () => showLanding(root), // 結算面板「回選歌」→ 回著陸頁(issue 09)
    onComplete, // 完賽寫入成績並回傳最佳(issue 18)
    autoPlay, // ?auto:自動演奏(展示用)
  });
}

interface ViewDeps {
  readonly title: string;
  readonly songName: string;
  readonly difficultyLabel: string;
  readonly coverUrl?: string;
  /** 譜面燈光時間線(issue 24);透傳給高速公路燈光 rig。 */
  readonly lightShow?: LightShow;
  readonly bpm: number;
  readonly songTimeOffset: number;
  /** 結算面板「回選歌」的導覽目標(issue 09);由 startSong 接回著陸頁。 */
  readonly onExit?: () => void;
  /** 完賽寫入成績並回傳最佳(issue 18);DEV 覆寫譜面 / 自動演奏時為 undefined(不記)。 */
  readonly onComplete?: (summary: JudgeSummary) => ResultsBest | null;
  /** ?auto:自動演奏(展示用),透傳給高速公路由音訊時鐘驅動合成按鍵。 */
  readonly autoPlay?: boolean;
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
        {
          songName: deps.songName,
          difficultyLabel: deps.difficultyLabel,
          coverUrl: deps.coverUrl,
          lightShow: deps.lightShow, // 譜面燈光(issue 24)
          beatSec: 60 / deps.bpm, // 充能預告提前窗=一拍(issue 25);bpm=0→Infinity,highway 退回固定值
          // 回選歌:先跑本視圖 cleanup(停音訊/卸事件/釋放 GPU),再由 startSong 切回著陸頁。
          onExit: deps.onExit ? () => { cleanup?.(); deps.onExit!(); } : undefined,
          onComplete: deps.onComplete, // 完賽寫入成績(issue 18)
          autoPlay: deps.autoPlay, // ?auto:自動演奏(展示用)
        },
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

/** 著陸畫面的流程編排:渲染畫面,選定來源後跑 bootstrap;失敗就地重繪帶錯誤訊息。 */
function showLanding(app: HTMLElement, errorMessage?: string): void {
  renderLandingScreen(app, {
    errorMessage,
    onRun: (source) => {
      bootstrap(app, source).catch((err: unknown) => {
        console.error(err);
        showLanding(app, err instanceof Error ? err.message : String(err));
      });
    },
  });
}

// 防呆:拖到拖放區以外時,別讓瀏覽器把 zip 當網址開掉。
for (const ev of ['dragover', 'drop'] as const) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

const app = document.getElementById('app');
if (app) showLanding(app);
