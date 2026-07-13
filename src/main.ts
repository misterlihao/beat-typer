// 進入點:組裝 loader / compile / audio / preview,跑端到端 tracer bullet。
// 內建範例 → parseInfo → compileChart → 表格預覽 + 音訊播放。
import { AudioPlayer } from './audio/player.ts';
import { compileChart, extractBpmSegments } from './compile/compileChart.ts';
import { customChartToDiffText, parseCustomChart } from './compile/customChart.ts';
import { buildBeatToSec, type BpmSegment } from './compile/bpmTimeline.ts';
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
    emphasized: false,
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
    { tSec: 0.6, key: 'KeyF', kind: 'hold', emphasized: false, holdEndSec: 2.0, hand: 'left', finger: 'index', bank: 'home' },
    { tSec: 2.5, key: 'KeyJ', kind: 'hold', emphasized: false, holdEndSec: 3.6, hand: 'right', finger: 'index', bank: 'home' },
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

  // 自製音符入口(issue 22 階段一):配當下這首歌的音訊/BPM/歌名/封面,自己排音符。
  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.textContent = '✎ 自製音符';
  customBtn.style.cssText =
    'display:block;width:100%;margin:8px 0 0;font-size:15px;padding:16px 24px;cursor:pointer;' +
    'border:1px dashed #5ad1c4;border-radius:12px;background:#161a24;color:#5ad1c4;';
  customBtn.addEventListener('click', () => showCustomEditor(root, song, info, infoText));
  groupsBox.appendChild(customBtn);

  root.querySelector<HTMLButtonElement>('#bt-back')!.addEventListener('click', () => showLanding(root));
}

// 自製譜面草稿(issue 22 階段一):每首歌一份,鍵=Info.dat 內容雜湊(跨來源穩定,複用 songKey)。
const customDraftKey = (infoText: string) => `beat-typer:custom-draft:${songKey(infoText)}`;
function loadCustomDraft(infoText: string): string {
  try {
    return localStorage.getItem(customDraftKey(infoText)) ?? '';
  } catch {
    return '';
  }
}
function saveCustomDraft(infoText: string, text: string): void {
  try {
    localStorage.setItem(customDraftKey(infoText), text);
  } catch {
    // 配額/停用 → 靜默略過(不影響編輯)
  }
}

// 首次進編輯器(無草稿)給的範例模板。
const CUSTOM_TEMPLATE = [
  '# 一行一顆音符: 拍  手(L/R)  種類(press/hold, 尾綴 ! = 強調)  [hold 的結束拍]',
  '# 拍以配樂的 BPM 計;# 起為註解。點下方任一行 → 從該拍自動演奏。',
  '0 L press',
  '1 R press',
  '2 L press!',
  '3 R press!',
  '4 L hold 6',
].join('\n');

/**
 * 自製音符編輯器(issue 22 階段一):就一塊 textarea。
 * 左鍵/鍵盤純編輯;**滑鼠移到某音符行,行右緣浮現 ▶,點它即從該行的拍自動演奏**
 * (免倒數、不手打、不記成績)。註解/空行不浮現。左鍵不再觸發播放,編輯無干擾。
 * 走 parseCustomChart → 生成 v3 難度檔 → compileChart(不繞過正規化)→ 高速公路。
 */
function showCustomEditor(root: HTMLElement, song: SongHandle, info: SongInfo, infoText: string): void {
  const songName = info.songName ?? song.title;
  root.innerHTML = `
    <div style="font-family:system-ui,sans-serif;color:#cdd3df;max-width:720px;margin:6vh auto;padding:0 20px">
      <button id="bt-back" type="button"
        style="font-size:13px;padding:6px 12px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#1b1f2a;color:#cdd3df">
        ← 返回
      </button>
      <h1 id="bt-song" style="font-size:22px;margin:16px 0 2px"></h1>
      <p style="color:#8b93a7;margin:0 0 12px;font-size:13px">自製音符 · 配這首歌的音樂 · <b>滑到某行 → 點浮現的 ▶</b> 從該拍自動演奏 · <b>反白多行 → 批次調拍 / 換手</b> · 不記成績</p>
      <div id="bt-editwrap" style="position:relative">
        <textarea id="bt-notes" spellcheck="false"
          style="display:block;width:100%;box-sizing:border-box;height:52vh;font-family:ui-monospace,Consolas,monospace;font-size:15px;
                 line-height:1.6;padding:12px 44px 12px 12px;border:1px solid #4a5163;border-radius:10px;background:#0e1118;color:#cdd3df;resize:vertical"></textarea>
        <button id="bt-playline" type="button" title="從這行試玩"
          style="display:none;position:absolute;right:14px;width:30px;height:26px;padding:0;cursor:pointer;
                 border:none;border-radius:7px;background:#2e86d6;color:#fff;font-size:13px;line-height:26px">▶</button>
        <div id="bt-linetools"
          style="display:none;position:absolute;left:12px;z-index:6;align-items:center;gap:6px;padding:5px 7px;
                 border:1px solid #4a5163;border-radius:9px;background:rgba(27,31,42,.92);box-shadow:0 3px 12px rgba(0,0,0,.4);font-size:12px">
          <span style="color:#8b93a7">選取行:</span>
          <input id="bt-step" type="number" step="0.5" value="1" title="offset 拍數"
            style="width:50px;font-size:12px;padding:2px 4px;border:1px solid #4a5163;border-radius:6px;background:#0e1118;color:#cdd3df">
          <button data-op="plus" type="button" style="cursor:pointer;padding:3px 8px;border:1px solid #4a5163;border-radius:7px;background:#2a303d;color:#cdd3df;font-size:12px">拍 ＋</button>
          <button data-op="minus" type="button" style="cursor:pointer;padding:3px 8px;border:1px solid #4a5163;border-radius:7px;background:#2a303d;color:#cdd3df;font-size:12px">拍 －</button>
          <button data-op="hand" type="button" style="cursor:pointer;padding:3px 8px;border:1px solid #4a5163;border-radius:7px;background:#2a303d;color:#cdd3df;font-size:12px">切換手 L⇄R</button>
        </div>
      </div>
      <div id="bt-error" style="min-height:20px;margin-top:10px;color:#e05656;white-space:pre-wrap;font-size:13px"></div>
    </div>`;
  root.querySelector<HTMLElement>('#bt-song')!.textContent = songName;
  const textarea = root.querySelector<HTMLTextAreaElement>('#bt-notes')!;
  const errorBox = root.querySelector<HTMLElement>('#bt-error')!;
  const wrap = root.querySelector<HTMLElement>('#bt-editwrap')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#bt-playline')!;

  // 草稿:有存讀回,否則給範例模板。編輯即自動存(護住快迭代,不怕誤重整)。
  const draft = loadCustomDraft(infoText);
  textarea.value = draft || CUSTOM_TEMPLATE;
  textarea.addEventListener('input', () => saveCustomDraft(infoText, textarea.value));

  root.querySelector<HTMLButtonElement>('#bt-back')!.addEventListener('click', () => {
    void showDifficultyScreen(root, song, info, infoText);
  });

  // 基底歌的變速表(讀一次、快取):讓自製拍與原曲同拍同秒。讀不到 → 等速退回。見 issue 22 變速修正。
  let baseBpm: BpmSegment[] | null = null;
  const loadBaseBpm = async (): Promise<BpmSegment[]> => {
    if (baseBpm) return baseBpm;
    const ref = info.difficulties[0];
    if (!ref) return (baseBpm = []);
    try {
      baseBpm = extractBpmSegments(decoder.decode(await song.readFile(ref.filename)));
    } catch {
      baseBpm = [];
    }
    return baseBpm;
  };

  // 從某拍自動演奏:整譜編譯後再濾前段(保留與全曲一致的鍵指派/收斂),不記成績。
  // 沿用基底歌的變速表:生成檔嵌 bpmEvents + startSec 用同一條 beat→秒,變速歌也對得準。
  const startFromBeat = async (startBeat: number) => {
    const ref = info.difficulties[0];
    if (!ref) {
      errorBox.textContent = '這首歌沒有可借用的難度槽,無法配樂';
      return;
    }
    const segments = await loadBaseBpm();
    let chart: TypingChart;
    try {
      const diffText = customChartToDiffText(parseCustomChart(textarea.value), segments);
      const keyGroup = loadSettings().keyGroup;
      chart = compileChart({ infoText, difficultyFiles: { [ref.filename]: diffText } }, ref.difficulty, { keyGroup });
    } catch (e) {
      errorBox.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    const startSec = buildBeatToSec(segments, info.bpm)(startBeat) + info.songTimeOffset;
    const sliced = chart.filter((n) => n.tSec >= startSec - 1e-6);
    if (sliced.length === 0) {
      errorBox.textContent = `第 ${startBeat} 拍之後沒有音符`;
      return;
    }
    mountPlayable(root, song, info, sliced, {
      difficultyLabel: '自製音符',
      startSec,
      autoPlay: true, // 自動演奏,不手打
      autoStart: true, // 免 321 倒數,直接開跑
      onExit: () => showCustomEditor(root, song, info, infoText), // 回編輯器(草稿已存)
    }).catch((err: unknown) => {
      console.error(err);
      showCustomEditor(root, song, info, infoText);
      root.querySelector<HTMLElement>('#bt-error')!.textContent = err instanceof Error ? err.message : String(err);
    });
  };

  // ── 浮現播放鈕:滑鼠所在行若是音符行,行右緣顯示 ▶(記住該行的拍);點它才播。 ──
  // 左鍵/鍵盤完全不觸發播放,編輯無干擾。滑鼠移出編輯區即收起。
  let hoverBeat: number | null = null;
  const cs = getComputedStyle(textarea);
  const lineH = parseFloat(cs.lineHeight) || 24;
  const padTop = parseFloat(cs.paddingTop) || 12;
  const beatOfLine = (lineIdx: number): number | null => {
    const stripped = (textarea.value.split('\n')[lineIdx] ?? '').replace(/#.*$/, '').trim();
    if (stripped === '') return null; // 註解/空行
    const b = Number(stripped.split(/\s+/)[0]);
    return Number.isFinite(b) && b >= 0 ? b : null; // 非音符行(拍不合法)不浮現
  };
  textarea.addEventListener('mousemove', (e) => {
    const y = e.clientY - textarea.getBoundingClientRect().top + textarea.scrollTop - padTop;
    const lineIdx = Math.floor(y / lineH);
    const beat = lineIdx >= 0 ? beatOfLine(lineIdx) : null;
    if (beat === null) {
      playBtn.style.display = 'none';
      hoverBeat = null;
      return;
    }
    hoverBeat = beat;
    playBtn.style.top = `${padTop + lineIdx * lineH - textarea.scrollTop - 1}px`;
    playBtn.style.display = 'block';
  });
  // 滑出整個編輯區(含移到 ▶ 上)才收起——移到鈕上時 mouseleave 目標在 wrap 內,不收。
  wrap.addEventListener('mouseleave', () => {
    playBtn.style.display = 'none';
    hoverBeat = null;
  });
  // 捲動時先收起 ▶(位置會偏),下次 mousemove 再以最新 scrollTop 重新定位;工具列則跟著選取重定位。
  textarea.addEventListener('scroll', () => {
    playBtn.style.display = 'none';
    hoverBeat = null;
    updateTools();
  });
  playBtn.addEventListener('click', () => {
    if (hoverBeat !== null) void startFromBeat(hoverBeat);
  });

  // ── 批次工具列:反白多行 → 上方浮出「調拍 ＋/－、切換手 L⇄R」,一次套到所有選取行。 ──
  // 只作用於選取涵蓋的整行;註解/空行/非音符行原封不動。改完自動存草稿並還原選取,方便連續調。
  const tools = root.querySelector<HTMLElement>('#bt-linetools')!;
  const stepInput = root.querySelector<HTMLInputElement>('#bt-step')!;
  const fmt = (x: number): string => String(+(x.toFixed(6))); // 去浮點雜訊:4→"4"、4.5→"4.5"

  // 選取涵蓋的行區間 [first, last](結尾剛好停在換行不算下一行)。
  const selectedLineRange = (): [number, number] => {
    const v = textarea.value;
    const s = textarea.selectionStart;
    const e = textarea.selectionEnd;
    const first = v.slice(0, s).split('\n').length - 1;
    const endIdx = e > s && v[e - 1] === '\n' ? e - 1 : e;
    const last = v.slice(0, endIdx).split('\n').length - 1;
    return [first, last];
  };

  // 拆行為 縮排 / 本體 / 行尾註解;本體再切 token(拍 手 種類 [結束拍])。
  const splitLine = (line: string) => {
    const hash = line.indexOf('#');
    const body = hash >= 0 ? line.slice(0, hash) : line;
    const comment = hash >= 0 ? line.slice(hash) : '';
    const indent = /^\s*/.exec(body)![0];
    return { indent, toks: body.trim() === '' ? [] : body.trim().split(/\s+/), comment };
  };
  const rebuild = (indent: string, toks: string[], comment: string): string =>
    comment ? `${indent}${toks.join(' ')} ${comment}` : `${indent}${toks.join(' ')}`;

  // 調拍:起始拍 + delta;若為長按(第 4 欄是數字結束拍)一併平移,長度不變。非音符行不動。
  const shiftBeatLine = (line: string, delta: number): string => {
    const { indent, toks, comment } = splitLine(line);
    if (toks.length === 0 || !Number.isFinite(Number(toks[0]))) return line;
    toks[0] = fmt(Number(toks[0]) + delta);
    if (toks.length >= 4 && Number.isFinite(Number(toks[3]))) toks[3] = fmt(Number(toks[3]) + delta);
    return rebuild(indent, toks, comment);
  };
  // 切換手:L⇄R(保留大小寫);手欄非 L/R 的行不動。
  const toggleHandLine = (line: string): string => {
    const { indent, toks, comment } = splitLine(line);
    if (toks.length < 2 || !Number.isFinite(Number(toks[0]))) return line;
    const flip: Record<string, string> = { L: 'R', l: 'r', R: 'L', r: 'l' };
    const nh = flip[toks[1]!];
    if (!nh) return line;
    toks[1] = nh;
    return rebuild(indent, toks, comment);
  };

  const applyToSelectedLines = (fn: (line: string) => string): void => {
    const [first, last] = selectedLineRange();
    const lines = textarea.value.split('\n');
    for (let i = first; i <= last; i++) lines[i] = fn(lines[i]!);
    const next = lines.join('\n');
    // 還原選取:涵蓋整段受影響行(行數不變,索引穩定)。
    const startIdx = lines.slice(0, first).join('\n').length + (first > 0 ? 1 : 0);
    const endIdx = startIdx + lines.slice(first, last + 1).join('\n').length;
    textarea.value = next;
    saveCustomDraft(infoText, next); // 程式改值不觸發 input,手動存
    textarea.focus();
    textarea.setSelectionRange(startIdx, endIdx);
    updateTools();
  };

  function updateTools(): void {
    if (document.activeElement !== textarea) return; // 焦點在步進框時不動它
    if (textarea.selectionStart === textarea.selectionEnd) {
      tools.style.display = 'none';
      return;
    }
    const [first, last] = selectedLineRange();
    tools.style.display = 'flex';
    const h = tools.offsetHeight || 34;
    const above = padTop + first * lineH - textarea.scrollTop - h - 4;
    tools.style.top =
      above >= 0 ? `${above}px` : `${padTop + (last + 1) * lineH - textarea.scrollTop + 4}px`;
  }

  // 點在既有選取內時,瀏覽器要等放開才收合選取;mouseup 當下讀到的還是舊選取,
  // 故延到下一 tick 再判定(此時已收合),否則反白消失了工具列卻留著。
  textarea.addEventListener('mouseup', () => setTimeout(updateTools, 0));
  textarea.addEventListener('keyup', updateTools);
  textarea.addEventListener('select', updateTools);
  // 步進框可正常聚焦打字;按鈕 mousedown 擋掉預設,保住 textarea 的選取與焦點。
  tools.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  tools.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.op === 'hand') {
      applyToSelectedLines(toggleHandLine);
      return;
    }
    const step = Number.isFinite(parseFloat(stepInput.value)) ? parseFloat(stepInput.value) : 1;
    const delta = btn.dataset.op === 'plus' ? step : -step;
    applyToSelectedLines((ln) => shiftBeatLine(ln, delta));
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
  const keyGroup = loadSettings().keyGroup;
  let chart = compileChart({ infoText, difficultyFiles: { [diff.filename]: diffText } }, diff.difficulty, {
    keyGroup,
  });

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

  const difficultyLabel = `${diff.characteristic} ${diff.difficulty}`;
  await mountPlayable(root, song, info, chart, {
    difficultyLabel,
    onComplete, // 完賽寫入成績並回傳最佳(issue 18)
    autoPlay, // ?auto:自動演奏(展示用)
    onExit: () => showLanding(root), // 結算面板「回選歌」→ 回著陸頁(issue 09)
  });
}

/**
 * 共用「開玩」薄層:解碼音訊 + 載封面 + 掛主視圖(高速公路 / 表格)。
 * startSong(正式難度)與自製編輯器試玩共用;差異只在 chart / onComplete / startSec / onExit。
 */
async function mountPlayable(
  root: HTMLElement,
  song: SongHandle,
  info: SongInfo,
  chart: TypingChart,
  opts: {
    difficultyLabel: string;
    onComplete?: (summary: JudgeSummary) => ResultsBest | null;
    autoPlay?: boolean;
    autoStart?: boolean;
    startSec?: number;
    onExit: () => void;
  },
): Promise<void> {
  // 讀音訊 bytes → 交給音訊層解碼(不經 compileChart)。
  const player = new AudioPlayer();
  const audioBytes = await song.readFile(info.audioFilename);
  try {
    await player.load(audioBytes);
  } catch {
    throw new Error('音訊檔無法解碼(可能不是支援的格式)');
  }

  // DEV-only 診斷 hook:方便在瀏覽器對齊音訊時鐘做手動/自動驗證。正式建置不掛。
  // __btChart = 當前實際遊玩的 chart(含鍵指派),供 playtest 按正確鍵對齊自動打。
  if (import.meta.env.DEV) {
    Reflect.set(window, '__btPlayer', player);
    Reflect.set(window, '__btChart', chart);
  }

  // 封面圖:載入新歌前 revoke 舊 URL;缺封面時 coverUrl=undefined,資訊卡改用佔位圖。
  if (currentCoverUrl) URL.revokeObjectURL(currentCoverUrl);
  currentCoverUrl = await loadCoverUrl(song, info.coverFilename);

  // 主視圖:3D 高速公路;可切換到表格預覽(開發驗證工具)。
  const songName = info.songName ?? song.title;
  mountViews(root, chart, player, {
    title: `${songName} — ${opts.difficultyLabel}`,
    songName,
    difficultyLabel: opts.difficultyLabel,
    coverUrl: currentCoverUrl,
    bpm: info.bpm,
    songTimeOffset: info.songTimeOffset,
    startSec: opts.startSec,
    onExit: opts.onExit,
    onComplete: opts.onComplete,
    autoPlay: opts.autoPlay,
    autoStart: opts.autoStart,
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
  /** 完賽寫入成績並回傳最佳(issue 18);DEV 覆寫譜面 / 自動演奏時為 undefined(不記)。 */
  readonly onComplete?: (summary: JudgeSummary) => ResultsBest | null;
  /** ?auto:自動演奏(展示用),透傳給高速公路由音訊時鐘驅動合成按鍵。 */
  readonly autoPlay?: boolean;
  /** 免倒數直接開跑(issue 22 自製譜面試玩)。 */
  readonly autoStart?: boolean;
  /** 中段起播秒數(issue 22 自製譜面);預設從頭。傳入 chart 應已濾成 tSec≥startSec。 */
  readonly startSec?: number;
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
          autoPlay: deps.autoPlay, // ?auto:自動演奏(展示用)
          autoStart: deps.autoStart, // 免倒數直接開跑(issue 22 自製譜面試玩)
          startSec: deps.startSec, // 中段起播(issue 22 自製譜面)
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
