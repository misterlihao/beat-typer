// 進入點:組裝 loader / compile / audio / preview,跑端到端 tracer bullet。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart } from './compile/compileChart.ts';
import { buildDifficultyMenu, noteStats } from './compile/difficultyMenu.ts';
import { parseInfo } from './compile/parseInfo.ts';
import { startHighway, type ResultsBest } from './highway/highway.ts';
import type { JudgeSummary } from './judge/types.ts';
import { adjustedAccuracy, loadScores, recordRun, songKey } from './scores/scores.ts';
import { BsrChartSource, parseBsrCode } from './loader/bsr.ts';
import { loadRecentBsr, recordRecentBsr, togglePinnedRecentBsr } from './loader/recentBsr.ts';
import { BuiltinChartSource } from './loader/builtin.ts';
import { ZipChartSource } from './loader/zip.ts';
import type { ChartSource, SongHandle } from './loader/types.ts';
import { renderPreview } from './preview/renderTable.ts';
import { KEY_GROUPS, type DifficultyRef, type KeyGroup, type SongInfo, type TypingChart } from './compile/types.ts';
import { loadSettings, patchSettings } from './settings/settings.ts';

// 難度畫面用的鍵群顯示名(issue 15);鍵群清單本身以 compile 的 KEY_GROUPS 為權威。
const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  all: '全鍵',
  home: '家排',
  'home-top': '家排+上排',
  'index-middle': '食指中指',
  'ring-pinky': '無名小指',
};

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
 * 難度選擇畫面(issue 17):列出可玩難度(濾 Lightshow、標準序、多特性分組)+ WPM 粗估。
 * 開畫面前預讀所有可玩難度檔算 WPM 並快取,選定後直接重用(不重讀)。選定 → startSong;返回 → 著陸畫面。
 */
async function showDifficultyScreen(
  root: HTMLElement,
  song: SongHandle,
  info: SongInfo,
  infoText: string,
): Promise<void> {
  const groups = buildDifficultyMenu(info.difficulties);
  if (groups.length === 0) throw new Error('這張譜沒有可玩難度(只有燈光譜)');

  // 預讀每個可玩難度檔 → 快取文字 + 打字速度粗估。
  // NPS ≈ 音符數 ÷ 末拍秒數(常數 BPM 近似);每顆音符 = 一次敲鍵、5 鍵 = 1 詞 → WPM = NPS × 60 ÷ 5 = NPS × 12。
  const cache = new Map<string, string>();
  const wpmLabel = new Map<string, string>();
  for (const g of groups) {
    for (const d of g.difficulties) {
      try {
        const text = decoder.decode(await song.readFile(d.filename));
        cache.set(d.filename, text);
        const { count, lastBeat } = noteStats(text);
        const nps = lastBeat > 0 ? count / ((lastBeat * 60) / info.bpm) : 0;
        wpmLabel.set(d.filename, nps > 0 ? `${Math.round(nps * 12)} WPM` : '');
      } catch {
        wpmLabel.set(d.filename, ''); // 讀失敗 → 無 WPM;真正的錯誤留待選定後編譯時暴露
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
      <p style="color:#8b93a7;margin:0 0 10px;text-align:center;font-size:13px">訓練鍵群</p>
      <div id="bt-keygroup" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 24px"></div>
      <p style="color:#8b93a7;margin:0 0 12px;text-align:center;font-size:13px">選擇難度</p>
      <div id="bt-groups"></div>
      <div id="bt-error" style="min-height:22px;margin-top:18px;color:#e05656;white-space:pre-wrap;text-align:center"></div>
    </div>`;
  root.querySelector<HTMLElement>('#bt-song')!.textContent = songName;
  const errorBox = root.querySelector<HTMLElement>('#bt-error')!;
  const groupsBox = root.querySelector<HTMLElement>('#bt-groups')!;

  // 鍵群選擇(issue 15):讀持久偏好當初值,切換即持久化;選定難度時由 startSong 讀回套進編譯。
  const kgBox = root.querySelector<HTMLElement>('#bt-keygroup')!;
  let currentGroup: KeyGroup = loadSettings().keyGroup;
  const renderKeyGroups = () => {
    kgBox.replaceChildren();
    for (const g of KEY_GROUPS) {
      const on = g === currentGroup;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = KEY_GROUP_LABELS[g];
      b.style.cssText =
        `font-size:13px;padding:9px 15px;cursor:pointer;border-radius:9px;` +
        `border:1px solid ${on ? '#5ad1c4' : '#4a5163'};` +
        `background:${on ? '#17282a' : '#161a24'};color:${on ? '#5ad1c4' : '#cdd3df'}`;
      b.addEventListener('click', () => {
        currentGroup = g;
        patchSettings({ keyGroup: g }); // 跨場持久化(issue 12 設定層)
        renderKeyGroups();
      });
      kgBox.appendChild(b);
    }
  };
  renderKeyGroups();

  const pick = (diff: DifficultyRef) => {
    errorBox.textContent = '';
    startSong(root, song, info, infoText, diff, cache.get(diff.filename)).catch((err: unknown) => {
      console.error(err);
      showLanding(root, err instanceof Error ? err.message : String(err));
    });
  };

  // 各難度的過去最佳成績(issue 19 切片):以難度檔身分查成績庫,顯示調整後準確率 + 達成鍵群。
  const scores = loadScores();
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
        'display:flex;justify-content:space-between;align-items:center;width:100%;margin:0 0 12px;' +
        'font-size:19px;padding:22px 24px;cursor:pointer;border:1px solid #4a5163;border-radius:12px;' +
        'background:#161a24;color:#cdd3df';
      // 左側:難度名 + WPM(打字速度粗估);右側:過去最佳(有紀錄才顯示,調整後準確率 + 鍵群)。
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;';
      const name = document.createElement('span');
      name.textContent = d.difficulty;
      left.appendChild(name);
      const wpmText = wpmLabel.get(d.filename) ?? '';
      if (wpmText) {
        const wpm = document.createElement('span');
        wpm.textContent = wpmText;
        wpm.style.cssText = 'color:#8b93a7;font-size:14px';
        left.appendChild(wpm);
      }
      // 右側:過去最佳,拆兩行——分數行大、模式(鍵群)行小。
      const diffText = cache.get(d.filename);
      const rec = diffText ? scores.records[songKey(diffText)] : undefined;
      const best = document.createElement('div');
      best.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;';
      if (rec) {
        const pct = (adjustedAccuracy(rec.bestRawAccuracy, rec.bestKeyGroup) * 100).toFixed(1);
        const score = document.createElement('span');
        score.style.cssText = 'font-size:18px;font-weight:700;color:#78c2b5;line-height:1';
        score.textContent = `最佳 ${pct}%`;
        const mode = document.createElement('span');
        mode.style.cssText = 'font-size:12px;color:#8b93a7;line-height:1';
        mode.textContent = KEY_GROUP_LABELS[rec.bestKeyGroup];
        best.append(score, mode);
      }
      btn.append(left, best);
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

  // 編譯成 TypingChart(純函式,唯一正規化點)。鍵群為跨場偏好,編譯前由設定層讀回(issue 15)。
  const keyGroup = loadSettings().keyGroup;
  let chart = compileChart({ infoText, difficultyFiles: { [diff.filename]: diffText } }, diff.difficulty, {
    keyGroup,
  });

  // DEV-only:?occtest / ?holdtest 用合成譜面覆寫(供 playtest);覆寫時不寫入成績(身分會對不上)。
  const params = new URLSearchParams(location.search);
  const devOverride = import.meta.env.DEV && (params.has('occtest') || params.has('holdtest'));
  if (import.meta.env.DEV && params.has('occtest')) {
    chart = makeOcclusionTestChart();
  }
  if (import.meta.env.DEV && params.has('holdtest')) {
    chart = makeHoldTestChart();
  }

  // 完賽寫入成績(issue 18):以難度檔身分 + 當前鍵群記錄,回傳顯示就緒的最佳。DEV 覆寫譜面不記。
  const onComplete = devOverride
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
  const difficultyLabel = `${diff.characteristic} ${diff.difficulty}`;
  mountViews(root, chart, player, {
    title: `${songName} — ${difficultyLabel}`,
    songName,
    difficultyLabel,
    coverUrl: currentCoverUrl,
    bpm: info.bpm,
    songTimeOffset: info.songTimeOffset,
    onExit: () => showLanding(root), // 結算面板「回選歌」→ 回著陸頁(issue 09)
    onComplete, // 完賽寫入成績並回傳最佳(issue 18)
  });
}

interface ViewDeps {
  readonly title: string;
  readonly songName: string;
  readonly difficultyLabel: string;
  readonly coverUrl?: string;
  readonly bpm: number;
  readonly songTimeOffset: number;
  /** 結算面板「回選歌」的導覽目標(issue 09);由 startSong 接回著陸頁。 */
  readonly onExit?: () => void;
  /** 完賽寫入成績並回傳最佳(issue 18);DEV 覆寫譜面時為 undefined(不記)。 */
  readonly onComplete?: (summary: JudgeSummary) => ResultsBest | null;
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
          beatSec: 60 / deps.bpm, // 充能預告提前窗=一拍(issue 25);bpm=0→Infinity,highway 退回固定值
          // 回選歌:先跑本視圖 cleanup(停音訊/卸事件/釋放 GPU),再由 startSong 切回著陸頁。
          onExit: deps.onExit ? () => { cleanup?.(); deps.onExit!(); } : undefined,
          onComplete: deps.onComplete, // 完賽寫入成績(issue 18)
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
      <div id="bt-recent"></div>
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

  // 最近遊玩的 BSR(issue 19 切片,釘選改版):BSR 輸入下方列出,點擊 = 重新下載重玩(同一套流程與錯誤處理)。
  // 每列附釘選切換鈕(取代刪除):釘選項目置頂、順序凍結、永不被上限淘汰,並以藍色 📌 + 左側藍邊條標示。
  // 顯示區約 6 列高、超出捲軸;清單為空則整區不顯示。切換後就地重繪。歌名 / 代號用 textContent,不信任外來字串。
  const recentBox = app.querySelector<HTMLElement>('#bt-recent')!;
  const renderRecent = () => {
    recentBox.replaceChildren();
    const recent = loadRecentBsr();
    if (recent.length === 0) return;
    const label = document.createElement('div');
    label.textContent = '最近';
    label.style.cssText = 'font-size:12px;color:#8b93a7;margin:20px 0 8px;text-align:left';
    const list = document.createElement('div');
    list.style.cssText = 'max-height:290px;overflow-y:auto;display:flex;flex-direction:column;gap:8px';
    for (const r of recent) {
      // 一列 = 可點的主鈕(下載重玩)+ 獨立釘選鈕(相鄰,非巢狀,避免點釘誤觸下載)。
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:stretch;gap:8px';
      const b = document.createElement('button');
      b.type = 'button';
      // 釘選列:左側藍邊條 + 略亮底,標示凍結置頂。
      b.style.cssText =
        'flex:1 1 auto;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;' +
        'font-size:14px;padding:11px 14px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;color:#cdd3df;' +
        (r.pinned ? 'background:#18233a;border-left:3px solid #6ea8fe' : 'background:#161a24');
      const name = document.createElement('span');
      name.textContent = r.songName;
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const code = document.createElement('span');
      code.textContent = r.code;
      code.style.cssText = 'flex:0 0 auto;font-size:12px;color:#8b93a7;font-variant-numeric:tabular-nums';
      b.append(name, code);
      b.addEventListener('click', () => run(new BsrChartSource(r.code), '下載中…'));
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.textContent = '📌';
      pin.title = r.pinned ? `取消釘選 ${r.code}` : `釘選 ${r.code}`;
      pin.setAttribute('aria-label', r.pinned ? `取消釘選 ${r.songName}` : `釘選 ${r.songName}`);
      pin.setAttribute('aria-pressed', String(r.pinned));
      // 已釘選:藍色實心;未釘選:灰、半透明。
      pin.style.cssText =
        'flex:0 0 auto;width:42px;cursor:pointer;border-radius:8px;font-size:14px;' +
        (r.pinned
          ? 'border:1px solid #6ea8fe;background:#1d2c48;color:#6ea8fe;opacity:1'
          : 'border:1px solid #4a5163;background:#161a24;color:#8b93a7;opacity:0.55');
      pin.addEventListener('click', () => {
        togglePinnedRecentBsr(r.code);
        renderRecent();
      });
      row.append(b, pin);
      list.appendChild(row);
    }
    recentBox.append(label, list);
  };
  renderRecent();

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
