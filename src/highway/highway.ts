// 3D 高速公路(薄渲染層):消費 TypingChart,音符從遠端沿 −Z 朝判定平面飛來,字母 billboard。
// 幾何:X=道(10 道照鍵盤排)、Y=列高度(上高下低)、Z=飛行。見 docs/adr/0002、0006 與 CONTEXT.md。
// 判定沿用 judge 的共用增量原語(Judger):keydown 當場 press()、每幀 expiry()。渲染/輸入是薄層,
// 判定邏輯不在此重寫(見 src/judge/judge.ts)。
import * as THREE from 'three';
import type { AudioPlayer } from '../audio/player.ts';
import { glyphOf } from '../compile/mapping.ts';
import type { Hand, TypingChart } from '../compile/types.ts';
import { Judger } from '../judge/judge.ts';
import { DEFAULT_JUDGE_CONFIG, type PressOutcome } from '../judge/types.ts';
import { loadSettings, patchSettings, SETTINGS_SPEC, type Settings } from '../settings/settings.ts';

export interface HighwayDeps {
  /** 顯示用歌名(資訊卡)。 */
  readonly songName: string;
  /** 顯示用難度標籤,如 "Standard ExpertPlus"(資訊卡)。 */
  readonly difficultyLabel: string;
  /** 封面圖 URL;缺漏時資訊卡改用佔位圖。 */
  readonly coverUrl?: string;
}

// ── 鍵盤版面:實體按鍵碼 → (欄 0..9 由左到右, 列 0下/1家/2上)。唯一的幾何真實來源。 ──
const KEY_LAYOUT: Readonly<Record<string, { col: number; row: number }>> = buildLayout();
function buildLayout(): Record<string, { col: number; row: number }> {
  const rows: [row: number, codes: string[]][] = [
    [2, ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']],
    [1, ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']],
    [0, ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']],
  ];
  const out: Record<string, { col: number; row: number }> = {};
  for (const [row, codes] of rows) codes.forEach((code, col) => (out[code] = { col, row }));
  return out;
}

// ── 幾何常數 ──
const LANE_SPACING = 1.1;
const ROW_SPACING = 1.0;
const FAR_Z = -40; // 音符生成的遠端(在霧內,一出生即清楚可見;見 grilling)
const PLANE_Z = 0; // 判定平面
const NOTE_SIZE = 0.72;
const COLS = 10;
const ROWS = 3;

const HAND_COLOR: Record<Hand, number> = { left: 0xe0503f, right: 0x2e86d6 };

const laneX = (col: number) => (col - (COLS - 1) / 2) * LANE_SPACING;
const rowY = (row: number) => (row - 1) * ROW_SPACING;

// ── 向上彎曲的飛行走廊(去除近/遠螢幕重疊,見 grilling)。 ──
// 抬升量只依「深度」加在 Y 上:判定平面(z=0)抬升=0(保留鍵盤空間對應),遠端才彎。
// ease-in:近端 FLAT_FRAC 比例保持平直讓判定進進手感自然;之後二次曲線加速上抬拉開預覽。
const FLAT_FRAC = 0.35; // 近端保持平直的深度比例
const LIFT_MAX = 5.5; // 遠端最大抬升(世界單位;實跑微調)
const liftAt = (z: number): number => {
  const d = THREE.MathUtils.clamp((PLANE_Z - z) / (PLANE_Z - FAR_Z), 0, 1); // 0=平面 .. 1=遠端
  if (d <= FLAT_FRAC) return 0;
  const t = (d - FLAT_FRAC) / (1 - FLAT_FRAC);
  return LIFT_MAX * t * t;
};
const HOLD_SEG = 16; // hold body 沿曲線的分段數(分段貼合)

// combo 多階段:門檻 20/50/100 換色,<20 為白(combo≥2 才顯示)。跨階瞬間數字 pop 放大。
const COMBO_TIERS: readonly { min: number; color: string }[] = [
  { min: 100, color: '#ffd23f' }, // 金(沿用判定金色系)
  { min: 50, color: '#b06ffb' }, // 紫
  { min: 20, color: '#5ad1c4' }, // 青藍
  { min: 0, color: '#eef1f7' }, // 白
];
const comboTier = (combo: number): number => COMBO_TIERS.findIndex((t) => combo >= t.min);

// 判定回饋字樣與顏色。
const FLASH_LABEL = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' } as const;
const FLASH_COLOR = { perfect: '#ffd23f', good: '#5ad17a', miss: '#ff5e5e' } as const;
const FLASH_MS = 450;

// 格子發光:按鍵反饋(任何按鍵亮其格)+ 打擊反饋(命中依判定上色)。
const CELL_MS = 260;
const CELL_COLOR = { perfect: 0xffd23f, good: 0x5ad17a, miss: 0xff5e5e, key: 0x9fb2d0 } as const;
const CELL_PEAK = { perfect: 0.95, good: 0.85, miss: 0.7, key: 0.32 } as const;

interface NoteVisual {
  readonly index: number; // chart 索引(對應 judge 的 noteIndex)
  readonly note: TypingChart[number];
  readonly col: number;
  readonly row: number;
  readonly sprite: THREE.Sprite;
  readonly box?: THREE.Mesh; // press:單一方塊
  readonly segments?: THREE.Mesh[]; // hold:沿曲線分段貼合的 body
  readonly material: THREE.Material; // 本音符的材質(press box / hold 各段共用),清理用
}

/**
 * 啟動高速公路。回傳清理函式(停動畫、卸事件、釋放 GPU 資源)。
 * @param root 掛載容器
 * @param chart 已編譯的 TypingChart(tSec 已含 songTimeOffset)
 * @param _deps 顯示用中繼(標題)
 * @param player 音訊層,提供 positionSec 主時鐘
 */
export function startHighway(
  root: HTMLElement,
  chart: TypingChart,
  deps: HighwayDeps,
  player: AudioPlayer,
): () => void {
  // 啟動時讀持久偏好當初值(飛行時間 / offset / 音量);缺值由 loadSettings 補預設(issue 12)。
  const settings = loadSettings();
  let flightTime = settings.flightTime;
  // offset 與判定共用同一份 config;滑桿更新 offsetSec,同時影響視覺與判定(PRD)。
  // 刻意不標 JudgeConfig(其 offsetSec 為 readonly);可變物件仍可傳給 Judger。
  const judgeConfig = { ...DEFAULT_JUDGE_CONFIG, offsetSec: settings.offsetSec };
  let judger: Judger | null = null;

  const container = document.createElement('div');
  // 視窗填滿:height:100dvh 精準等於視窗高(dvh 連手機工具列伸縮也吸收),overflow:hidden 確保不出卷軸。
  // 只套在高速公路視圖;表格預覽維持自身可捲動。100vh 為舊瀏覽器 fallback。
  container.style.cssText =
    'position:relative;width:100%;height:100vh;height:100dvh;overflow:hidden;background:#0b0d12;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  ensureHudStyle();
  container.appendChild(canvas);
  container.appendChild(buildInfoCard(deps));
  container.appendChild(buildControls(settings));
  container.appendChild(buildFeedback());
  container.appendChild(buildPauseOverlay());
  root.replaceChildren(container);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0d12, 25, 70); // 盡頭拉到 FAR_Z 之外,生成點清楚可見

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 3.9, 8);
  camera.lookAt(0, 1.0, -16); // 稍抬視線中心以框住遠端上彎的音符(相機仍低角度保沉浸感)

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0, 8, 6);
  scene.add(dir);
  scene.add(buildTargetGrid());

  // 每個鍵盤格一片可發光的面(按鍵/打擊反饋)。放在標籤後方,發光時字仍讀得到。
  const cellGeo = new THREE.PlaneGeometry(LANE_SPACING * 0.9, ROW_SPACING * 0.9);
  const cells = new Map<string, THREE.Mesh>();
  for (const [code, { col, row }] of Object.entries(KEY_LAYOUT)) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(cellGeo, mat);
    mesh.position.set(laneX(col), rowY(row), PLANE_Z - 0.02);
    mesh.userData.flashStart = -Infinity;
    mesh.userData.peak = 0;
    scene.add(mesh);
    cells.set(code, mesh);
  }
  const activateCell = (code: string, color: number, peak: number) => {
    const mesh = cells.get(code);
    if (!mesh) return;
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    mesh.userData.flashStart = performance.now();
    mesh.userData.peak = peak;
  };

  // 為每顆音符建 body + glyph sprite,一次建齊,以可見性切換(範例譜面音符少)。
  // press:單一方塊;hold:HOLD_SEG 段小方塊,每幀重新沿彎曲走廊定位(分段貼合)。
  const visuals: NoteVisual[] = [];
  const boxGeo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  const segGeo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, 1); // 單位長,每幀縮放 Z
  chart.forEach((note, index) => {
    const layout = KEY_LAYOUT[note.key];
    if (!layout) return; // 未知鍵碼,略過(理論上不會發生)
    const mat = new THREE.MeshLambertMaterial({ color: HAND_COLOR[note.hand] });
    const sprite = makeGlyphSprite(glyphOf(note.key), '#ffffff', 0.85, true);
    sprite.visible = false;
    const base = { index, note, col: layout.col, row: layout.row, sprite, material: mat };
    if (note.kind === 'hold' && note.holdEndSec !== undefined) {
      const segments: THREE.Mesh[] = [];
      for (let i = 0; i < HOLD_SEG; i++) {
        const seg = new THREE.Mesh(segGeo, mat);
        seg.visible = false;
        scene.add(seg);
        segments.push(seg);
      }
      scene.add(sprite);
      visuals.push({ ...base, segments });
    } else {
      const box = new THREE.Mesh(boxGeo, mat);
      box.visible = false;
      scene.add(box, sprite);
      visuals.push({ ...base, box });
    }
  });

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // ── 回饋 DOM ──
  const comboEl = container.querySelector<HTMLDivElement>('.bt-combo')!;
  const flashEl = container.querySelector<HTMLDivElement>('.bt-flash')!;
  const progressEl = container.querySelector<HTMLDivElement>('.bt-progress-fill')!;
  const timeEl = container.querySelector<HTMLDivElement>('.bt-time')!;
  let flashStart = -Infinity;
  const flash = (kind: 'perfect' | 'good' | 'miss') => {
    flashEl.textContent = FLASH_LABEL[kind];
    flashEl.style.color = FLASH_COLOR[kind];
    flashStart = performance.now();
  };
  // combo:≥2 才顯示;跨過 20/50/100 門檻換色,且升級瞬間數字 pop 放大。
  let lastTier = comboTier(0);
  const showCombo = () => {
    const combo = judger?.currentCombo ?? 0;
    if (combo < 2) {
      comboEl.textContent = '';
      lastTier = comboTier(0);
      return;
    }
    comboEl.textContent = `${combo}`;
    const tier = comboTier(combo);
    comboEl.style.color = COMBO_TIERS[tier]!.color;
    if (tier < lastTier) {
      // tier 索引越小=階越高;升級 → 重播 pop 動畫(移除→reflow→加回)。
      comboEl.classList.remove('bt-pop');
      void comboEl.offsetWidth;
      comboEl.classList.add('bt-pop');
    }
    lastTier = tier;
  };

  // mm:ss 時間格式(進度條數字)。
  const fmtTime = (s: number): string => {
    const t = Math.max(0, Math.floor(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const showProgress = () => {
    const dur = player.duration;
    const frac = dur > 0 ? THREE.MathUtils.clamp(player.positionSec / dur, 0, 1) : 0;
    progressEl.style.width = `${frac * 100}%`;
    timeEl.textContent = `${fmtTime(player.positionSec)} / ${fmtTime(dur)}`;
  };
  showProgress(); // 進場先顯示 0:00 / 總長

  // ── 每幀:音符位置 ──
  const distZ = PLANE_Z - FAR_Z;
  const zAt = (p: number) => FAR_Z + THREE.MathUtils.clamp(p, 0, 1) * distZ;

  const setVisible = (v: NoteVisual, on: boolean) => {
    v.sprite.visible = on;
    if (v.box) v.box.visible = on;
    if (v.segments) for (const s of v.segments) s.visible = on;
  };

  const positionNotes = (now: number) => {
    for (const v of visuals) {
      if (judger?.resultAt(v.index)) {
        setVisible(v, false); // 已判定 → 收起(回饋靠 combo/閃字)
        continue;
      }
      const arrival = v.note.tSec + judgeConfig.offsetSec;
      const pHead = (now - (arrival - flightTime)) / flightTime;
      const x = laneX(v.col);
      const baseY = rowY(v.row);
      if (v.segments && v.note.holdEndSec !== undefined) {
        const arrivalTail = v.note.holdEndSec + judgeConfig.offsetSec;
        const pTail = (now - (arrivalTail - flightTime)) / flightTime;
        const visible = pHead <= 1 && pTail >= 0;
        setVisible(v, visible);
        if (visible) {
          // body 沿彎曲走廊分段貼合:每段取子區間中點的深度求抬升,縮放 Z 填滿該段。
          for (let i = 0; i < HOLD_SEG; i++) {
            const za = zAt(THREE.MathUtils.lerp(pTail, pHead, i / HOLD_SEG));
            const zb = zAt(THREE.MathUtils.lerp(pTail, pHead, (i + 1) / HOLD_SEG));
            const zc = (za + zb) / 2;
            const seg = v.segments[i]!;
            seg.position.set(x, baseY + liftAt(zc), zc);
            seg.scale.set(1, 1, Math.max(0.02, (zb - za) * 1.15)); // 略重疊避免接縫
          }
          const headZ = zAt(pHead);
          v.sprite.position.set(x, baseY + liftAt(headZ), headZ + 0.5);
        }
      } else if (v.box) {
        const visible = pHead >= 0 && pHead <= 1;
        setVisible(v, visible);
        if (visible) {
          const z = zAt(pHead);
          const y = baseY + liftAt(z);
          v.box.position.set(x, y, z);
          v.sprite.position.set(x, y, z + 0.5);
        }
      }
    }
  };

  let raf = 0;
  // 遊戲狀態機(issue 13):idle → playing ⇄ paused;playing → ended。控制鍵與覆蓋層據此。
  let state: 'idle' | 'playing' | 'paused' | 'ended' = 'idle';
  const loop = (ts: number) => {
    const now = player.positionSec;
    if (judger) {
      const missed = judger.expiry(now); // 過期未敲 → Miss(打擊反饋:該音符的格閃紅)
      if (missed.length > 0) {
        flash('miss');
        for (const i of missed) activateCell(chart[i]!.key, CELL_COLOR.miss, CELL_PEAK.miss);
      }
      showCombo();
    }
    showProgress();
    const age = ts - flashStart; // 回饋閃字淡出
    flashEl.style.opacity = age < FLASH_MS ? String(1 - age / FLASH_MS) : '0';

    // 格子發光淡出
    for (const mesh of cells.values()) {
      const cage = ts - (mesh.userData.flashStart as number);
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        cage < CELL_MS ? (mesh.userData.peak as number) * (1 - cage / CELL_MS) : 0;
    }

    positionNotes(now);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const startLoop = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const stopLoop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  positionNotes(-Infinity); // 進場靜態畫面(格線),按下開始才播放並啟動迴圈
  renderer.render(scene, camera);

  // ── 輸入:遊玩中收 keydown,當場 press 給即時回饋 ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (!judger || !player.isPlaying || e.repeat) return;
    if (!(e.code in KEY_LAYOUT)) return;
    const outcome: PressOutcome = judger.press({ t: player.positionSec, key: e.code });
    // 按鍵音:Perfect 清脆高音、其他稍低沉以利區分。press 為同步,延遲無感、仍即時。
    player.playTick(outcome.kind === 'perfect' ? 'high' : 'low');
    // 按鍵反饋:按下的格必亮;顏色依判定(打擊反饋),多餘按鍵用中性色。
    const kind = outcome.kind === 'extra' ? 'key' : outcome.kind;
    activateCell(e.code, CELL_COLOR[kind], CELL_PEAK[kind]);
    if (outcome.kind !== 'extra') flash(outcome.kind);
    showCombo();
  };
  window.addEventListener('keydown', onKeyDown);

  // ── 控制列自動顯隱:滑鼠靠近底部才淡入;開始前(需按開始鈕)恆顯,不遮遊玩畫面。 ──
  const bar = container.querySelector<HTMLDivElement>('.bt-controls')!;
  const REVEAL_PX = 140;
  let barPinned = true; // 尚未開始 → 恆顯
  const setBarShown = (shown: boolean) => {
    bar.style.opacity = shown ? '1' : '0';
    bar.style.transform = shown ? 'translateY(0)' : 'translateY(100%)';
    bar.style.pointerEvents = shown ? 'auto' : 'none';
  };
  setBarShown(true);
  const onPointerMove = (e: PointerEvent) => {
    if (barPinned) return;
    const rect = container.getBoundingClientRect();
    setBarShown(e.clientY >= rect.bottom - REVEAL_PX);
  };
  container.addEventListener('pointermove', onPointerMove);

  // ── 控制:開始 / 暫停 / 繼續 / 重新開始(issue 13) ──
  const startBtn = container.querySelector<HTMLButtonElement>('.bt-start')!;
  const overlay = container.querySelector<HTMLDivElement>('.bt-overlay')!;
  const overlayTitle = container.querySelector<HTMLDivElement>('.bt-overlay-title')!;
  const resumeBtn = container.querySelector<HTMLButtonElement>('.bt-resume')!;
  const restartBtn = container.querySelector<HTMLButtonElement>('.bt-restart')!;
  const overlayHint = container.querySelector<HTMLDivElement>('.bt-overlay-hint')!;

  const showOverlay = (mode: 'paused' | 'ended') => {
    overlayTitle.textContent = mode === 'paused' ? '暫停中' : '完成!';
    // 結束無從繼續,只能重新開始 → 藏繼續鈕與其提示。
    resumeBtn.style.display = mode === 'paused' ? '' : 'none';
    overlayHint.style.display = mode === 'paused' ? '' : 'none';
    overlay.style.display = 'grid';
  };
  const hideOverlay = () => {
    overlay.style.display = 'none';
  };

  // 回饋/音符/combo 全重置到未開始狀態(重新開始與 issue 09 重玩共用)。
  const resetVisualState = () => {
    flashStart = -Infinity;
    flashEl.style.opacity = '0';
    lastTier = comboTier(0);
    comboEl.textContent = '';
    comboEl.classList.remove('bt-pop');
    for (const mesh of cells.values()) {
      mesh.userData.flashStart = -Infinity;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    for (const v of visuals) setVisible(v, false); // loop 首幀會重新定位
    showProgress();
  };

  // 從 0 完整重來:重建 Judger、清狀態、play(0)、啟動迴圈。開始鈕與重新開始鈕共用。
  const beginFromZero = async () => {
    hideOverlay();
    barPinned = false; // 遊玩中改為滑鼠靠近才顯(從暫停按重開時也還原)
    setBarShown(false);
    judger = new Judger(chart, judgeConfig);
    resetVisualState();
    await player.play(0);
    state = 'playing';
    startLoop();
  };
  const pauseRun = () => {
    if (state !== 'playing') return;
    player.pause(); // 凍結 positionSec → 暫停期間不流逝、迴圈停 → 無假 Miss
    stopLoop();
    state = 'paused';
    showOverlay('paused');
    barPinned = true; // 暫停中固定顯示控制列,讓玩家能就地調整滑桿(疊在覆蓋層之上)
    setBarShown(true);
  };
  const resumeRun = () => {
    if (state !== 'paused') return;
    hideOverlay();
    barPinned = false; // 還原遊玩中的自動顯隱
    setBarShown(false);
    state = 'playing';
    void player.play(); // 從凍結位置續播
    startLoop();
  };

  startBtn.addEventListener('click', () => {
    void (async () => {
      startBtn.style.display = 'none';
      await beginFromZero();
    })();
  });
  resumeBtn.addEventListener('click', resumeRun);
  restartBtn.addEventListener('click', () => void beginFromZero());

  // 歌自然播完:收尾最後一次判定,停迴圈,顯示結束覆蓋層(可重新開始)。
  player.onEnded = () => {
    if (judger) {
      judger.expiry(player.duration);
      showCombo();
    }
    positionNotes(player.duration);
    renderer.render(scene, camera);
    stopLoop();
    state = 'ended';
    showOverlay('ended');
  };

  // Space / Escape 皆切換 暫停⇄繼續(非遊戲鍵;preventDefault 防捲動)。僅遊玩/暫停中作用。
  const onControlKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.code !== 'Space' && e.code !== 'Escape')) return;
    if (state !== 'playing' && state !== 'paused') return;
    e.preventDefault();
    if (state === 'playing') pauseRun();
    else resumeRun();
  };
  window.addEventListener('keydown', onControlKey);

  // 分頁切到背景 → 自動暫停(背景凍結 rAF 但音訊續播,回來時會一次判一堆 Miss、combo 整斷)。
  const onVisibility = () => {
    if (document.hidden) pauseRun();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const flightInput = container.querySelector<HTMLInputElement>('.bt-flight')!;
  const flightVal = container.querySelector<HTMLSpanElement>('.bt-flight-val')!;
  const offsetInput = container.querySelector<HTMLInputElement>('.bt-offset')!;
  const offsetVal = container.querySelector<HTMLSpanElement>('.bt-offset-val')!;
  // 三滑桿:input 時即時套用到遊戲,並順手 patchSettings 持久化(issue 12,單 listener)。
  flightInput.addEventListener('input', () => {
    flightTime = Number(flightInput.value);
    flightVal.textContent = `${flightTime.toFixed(2)}s`;
    patchSettings({ flightTime });
  });
  offsetInput.addEventListener('input', () => {
    judgeConfig.offsetSec = Number(offsetInput.value);
    offsetVal.textContent = `${judgeConfig.offsetSec >= 0 ? '+' : ''}${judgeConfig.offsetSec.toFixed(3)}s`;
    patchSettings({ offsetSec: judgeConfig.offsetSec });
  });

  // 按鍵音量:縮放 tick 峰值(0=靜音)。共用同一個 player,切視圖也保留設定。
  const volumeInput = container.querySelector<HTMLInputElement>('.bt-volume')!;
  const volumeVal = container.querySelector<HTMLSpanElement>('.bt-volume-val')!;
  player.tickVolume = settings.tickVolume;
  volumeInput.addEventListener('input', () => {
    player.tickVolume = Number(volumeInput.value);
    volumeVal.textContent = `${Math.round(player.tickVolume * 100)}%`;
    patchSettings({ tickVolume: player.tickVolume });
  });

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keydown', onControlKey);
    document.removeEventListener('visibilitychange', onVisibility);
    player.onEnded = null; // 卸載前解除,避免切到預覽後仍觸發本視圖的結束處理
    container.removeEventListener('pointermove', onPointerMove);
    boxGeo.dispose();
    segGeo.dispose();
    cellGeo.dispose();
    for (const mesh of cells.values()) (mesh.material as THREE.Material).dispose();
    for (const v of visuals) {
      v.material.dispose(); // press box / hold 各段共用同一材質
      v.sprite.material.map?.dispose();
      v.sprite.material.dispose();
    }
    renderer.dispose();
    if (player.isPlaying) player.pause();
  };
}

// ── 判定平面的靜態目標格線(10×3)+ 淡淡字母標籤,示意鍵盤與手指預備位。 ──
function buildTargetGrid(): THREE.Group {
  const group = new THREE.Group();
  const halfW = (COLS / 2) * LANE_SPACING;
  const halfH = (ROWS / 2) * ROW_SPACING;

  const pts: number[] = [];
  for (let c = 0; c <= COLS; c++) {
    const x = c * LANE_SPACING - halfW;
    pts.push(x, -halfH, PLANE_Z, x, halfH, PLANE_Z);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = r * ROW_SPACING - halfH;
    pts.push(-halfW, y, PLANE_Z, halfW, y, PLANE_Z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x394155 })));

  for (const [code, { col, row }] of Object.entries(KEY_LAYOUT)) {
    const label = makeGlyphSprite(glyphOf(code), 'rgba(150,160,180,0.5)', 0.55);
    label.position.set(laneX(col), rowY(row), PLANE_Z - 0.01);
    group.add(label);
  }
  return group;
}

// ── 字母 billboard:canvas 貼圖 Sprite,天生面向鏡頭。 ──
// onTop:音符字母關掉深度測試並拉高 renderOrder,即使 cube 被較近音符擋住,要敲的字母仍恆可讀
// (同列上/下段在極短同指間隔會短暫 cube 重疊;字母置頂確保不被完全遮蔽)。
function makeGlyphSprite(glyph: string, color = '#ffffff', scale = 0.85, onTop = false): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 自動把每個字形依實際墨跡放大置中,填滿畫布的 ~66%——小標點(, . / ;)不再又小又難分。
  const target = size * 0.66;
  const base = 100;
  ctx.font = `bold ${base}px system-ui, sans-serif`;
  const m0 = ctx.measureText(glyph);
  const w0 = m0.actualBoundingBoxLeft + m0.actualBoundingBoxRight || m0.width || base * 0.6;
  const h0 = m0.actualBoundingBoxAscent + m0.actualBoundingBoxDescent || base * 0.7;
  const fontSize = Math.min(base * Math.min(target / w0, target / h0), 132);
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const m = ctx.measureText(glyph);
  const ox = size / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const oy = size / 2 - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  ctx.fillText(glyph, ox, oy);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: !onTop, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  if (onTop) sprite.renderOrder = 10; // 畫在 cube 之後,永遠可讀
  return sprite;
}

// ── 疊在畫布上的 HTML 控制列(底部;右側留白避開「切換預覽」浮鈕) ──
// 預設隱藏,滑鼠靠近底部或開始前(需按開始鈕)才淡入;由 startHighway 綁定顯隱。
function buildControls(settings: Settings): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bt-controls';
  bar.style.cssText =
    'position:absolute;left:0;bottom:0;right:0;display:flex;gap:16px;align-items:center;flex-wrap:wrap;' +
    'padding:12px 170px 12px 14px;font-family:system-ui,sans-serif;font-size:13px;color:#cdd3df;' +
    'background:linear-gradient(#0b0d1200,#0b0d12dd);z-index:6;' + // 高於暫停覆蓋層(5),暫停中滑桿仍可操作
    'transition:opacity .2s ease, transform .2s ease;';
  // 滑桿 min/max/step 與初值全來自 SETTINGS_SPEC + 持久設定(issue 12),不再寫死。
  const f = SETTINGS_SPEC.flightTime;
  const o = SETTINGS_SPEC.offsetSec;
  const v = SETTINGS_SPEC.tickVolume;
  bar.innerHTML = `
    <button type="button" class="bt-start"
      style="font-size:15px;padding:8px 20px;cursor:pointer;border:0;border-radius:6px;background:#2e86d6;color:#fff;">
      ▶ 開始
    </button>
    <label style="display:flex;gap:6px;align-items:center;">飛行時間
      <input type="range" class="bt-flight" min="${f.min}" max="${f.max}" step="${f.step}" value="${settings.flightTime}" />
      <span class="bt-flight-val" style="width:44px;">${settings.flightTime.toFixed(2)}s</span>
    </label>
    <label style="display:flex;gap:6px;align-items:center;">offset
      <input type="range" class="bt-offset" min="${o.min}" max="${o.max}" step="${o.step}" value="${settings.offsetSec}" />
      <span class="bt-offset-val" style="width:52px;">${settings.offsetSec >= 0 ? '+' : ''}${settings.offsetSec.toFixed(3)}s</span>
    </label>
    <label style="display:flex;gap:6px;align-items:center;">按鍵音量
      <input type="range" class="bt-volume" min="${v.min}" max="${v.max}" step="${v.step}" value="${settings.tickVolume}" />
      <span class="bt-volume-val" style="width:40px;">${Math.round(settings.tickVolume * 100)}%</span>
    </label>`;
  return bar;
}

// ── 暫停 / 結束覆蓋層(issue 13):半透明暗幕 + 標題 + 繼續 / 重新開始。預設隱藏,由 startHighway 控制。 ──
function buildPauseOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'bt-overlay';
  overlay.style.cssText =
    'position:absolute;inset:0;display:none;place-items:center;z-index:5;' +
    'background:#0b0d12cc;font-family:system-ui,sans-serif;color:#eef1f7;';
  const btn = 'font-size:15px;padding:9px 22px;cursor:pointer;border:0;border-radius:8px;';
  overlay.innerHTML = `
    <div style="text-align:center;">
      <div class="bt-overlay-title" style="font-size:34px;letter-spacing:2px;margin-bottom:6px;">暫停中</div>
      <div class="bt-overlay-hint" style="font-size:13px;color:#8b93a7;margin-bottom:26px;">Space / Esc 繼續</div>
      <div style="display:flex;gap:14px;justify-content:center;">
        <button type="button" class="bt-resume" style="${btn}background:#2e86d6;color:#fff;">繼續</button>
        <button type="button" class="bt-restart" style="${btn}background:#2b3040;color:#cdd3df;">重新開始</button>
      </div>
    </div>`;
  return overlay;
}

// ── 頂部進度條 + 時間、combo(右上)、判定閃字(中央) ──
function buildFeedback(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;z-index:1;';
  // 進度條:頂端全寬細線 + 時間數字(置中、細線正下方);combo:右上角(多階段換色 + 升級 pop);
  // 閃字:上方中央大字(不擋來襲音符)。
  wrap.innerHTML = `
    <div class="bt-progress" style="position:absolute;top:0;left:0;right:0;height:8px;background:#1e2430;">
      <div class="bt-progress-fill" style="height:100%;width:0;background:#6ea8fe;transition:width .1s linear;"></div>
    </div>
    <div class="bt-time" style="position:absolute;top:14px;left:0;right:0;text-align:center;
      font-size:16px;font-variant-numeric:tabular-nums;color:#8b93a7;text-shadow:0 1px 3px #000;"></div>
    <div class="bt-combo" style="position:absolute;right:20px;top:18px;
      font-size:58px;font-weight:800;color:#eef1f7;opacity:0.95;text-shadow:0 2px 8px #000;
      transform-origin:100% 50%;line-height:1;"></div>
    <div class="bt-flash" style="position:absolute;top:12%;left:0;right:0;text-align:center;
      font-size:44px;font-weight:900;opacity:0;text-shadow:0 2px 10px #000;"></div>`;
  return wrap;
}

// ── 左上角譜面資訊卡:封面(缺圖→佔位)+ 歌名 + 難度,全程常駐。 ──
function buildInfoCard(deps: HighwayDeps): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'position:absolute;left:12px;top:12px;z-index:2;display:flex;gap:10px;align-items:center;' +
    'max-width:44%;padding:8px 12px 8px 8px;border-radius:10px;' +
    'background:#12151dcc;border:1px solid #2a3040;font-family:system-ui,sans-serif;' +
    'backdrop-filter:blur(3px);';
  const cover = deps.coverUrl
    ? `<img src="${deps.coverUrl}" alt=""
         style="width:44px;height:44px;border-radius:6px;object-fit:cover;display:block;flex:0 0 auto;" />`
    : `<div style="width:44px;height:44px;border-radius:6px;flex:0 0 auto;display:flex;
         align-items:center;justify-content:center;font-size:22px;color:#8b93a7;
         background:linear-gradient(135deg,#2a3142,#1a1f2b);">♪</div>`;
  card.innerHTML = `
    ${cover}
    <div style="min-width:0;">
      <div title="${escapeAttr(deps.songName)}" style="font-size:14px;font-weight:700;color:#eef1f7;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26ch;">${escapeHtml(deps.songName)}</div>
      <div style="font-size:12px;color:#8b93a7;margin-top:2px;">${escapeHtml(deps.difficultyLabel)}</div>
    </div>`;
  return card;
}

// 一次性注入 HUD 的 keyframes(combo 升級 pop)。多次呼叫只注入一次。
function ensureHudStyle(): void {
  if (document.getElementById('bt-hud-style')) return;
  const style = document.createElement('style');
  style.id = 'bt-hud-style';
  style.textContent = `
    @keyframes bt-combo-pop { 0% { transform: scale(1.45); } 100% { transform: scale(1); } }
    .bt-combo.bt-pop { animation: bt-combo-pop 260ms cubic-bezier(.2,.9,.3,1); }`;
  document.head.appendChild(style);
}

// 文字/屬性轉義(歌名可能含 < & " 等字元)。
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
