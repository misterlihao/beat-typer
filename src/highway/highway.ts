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

export interface HighwayDeps {
  readonly title: string;
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
const FAR_Z = -55; // 音符生成的遠端
const PLANE_Z = 0; // 判定平面
const NOTE_SIZE = 0.72;
const COLS = 10;
const ROWS = 3;

const HAND_COLOR: Record<Hand, number> = { left: 0xe0503f, right: 0x2e86d6 };

const laneX = (col: number) => (col - (COLS - 1) / 2) * LANE_SPACING;
const rowY = (row: number) => (row - 1) * ROW_SPACING;

const FLIGHT_DEFAULT = 1.75;
const OFFSET_DEFAULT = 0;

// 判定回饋字樣與顏色。
const FLASH_LABEL = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' } as const;
const FLASH_COLOR = { perfect: '#ffd23f', good: '#5ad17a', miss: '#ff5e5e' } as const;
const FLASH_MS = 450;

interface NoteVisual {
  readonly index: number; // chart 索引(對應 judge 的 noteIndex)
  readonly note: TypingChart[number];
  readonly col: number;
  readonly row: number;
  readonly box: THREE.Mesh;
  readonly sprite: THREE.Sprite;
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
  _deps: HighwayDeps,
  player: AudioPlayer,
): () => void {
  let flightTime = FLIGHT_DEFAULT;
  // offset 與判定共用同一份 config;滑桿更新 offsetSec,同時影響視覺與判定(PRD)。
  // 刻意不標 JudgeConfig(其 offsetSec 為 readonly);可變物件仍可傳給 Judger。
  const judgeConfig = { ...DEFAULT_JUDGE_CONFIG, offsetSec: OFFSET_DEFAULT };
  let judger: Judger | null = null;

  const container = document.createElement('div');
  container.style.cssText = 'position:relative;width:100%;height:100%;min-height:70vh;background:#0b0d12;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  container.appendChild(canvas);
  container.appendChild(buildControls());
  container.appendChild(buildFeedback());
  root.replaceChildren(container);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0d12, 25, 58);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 3.4, 8);
  camera.lookAt(0, 0.2, -18);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0, 8, 6);
  scene.add(dir);
  scene.add(buildTargetGrid());

  // 為每顆音符建 box + glyph sprite,一次建齊,以可見性切換(範例譜面音符少)。
  const visuals: NoteVisual[] = [];
  const boxGeo = new THREE.BoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE);
  chart.forEach((note, index) => {
    const layout = KEY_LAYOUT[note.key];
    if (!layout) return; // 未知鍵碼,略過(理論上不會發生)
    const mat = new THREE.MeshLambertMaterial({ color: HAND_COLOR[note.hand] });
    const box = new THREE.Mesh(boxGeo, mat);
    box.visible = false;
    const sprite = makeGlyphSprite(glyphOf(note.key));
    sprite.visible = false;
    scene.add(box, sprite);
    visuals.push({ index, note, col: layout.col, row: layout.row, box, sprite });
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
  let flashStart = -Infinity;
  const flash = (kind: 'perfect' | 'good' | 'miss') => {
    flashEl.textContent = FLASH_LABEL[kind];
    flashEl.style.color = FLASH_COLOR[kind];
    flashStart = performance.now();
  };
  const showCombo = () => {
    const combo = judger?.currentCombo ?? 0;
    comboEl.textContent = combo >= 2 ? `${combo} combo` : '';
  };

  // ── 每幀:音符位置 ──
  const distZ = PLANE_Z - FAR_Z;
  const zAt = (p: number) => FAR_Z + THREE.MathUtils.clamp(p, 0, 1) * distZ;

  const positionNotes = (now: number) => {
    for (const v of visuals) {
      if (judger?.resultAt(v.index)) {
        v.box.visible = v.sprite.visible = false; // 已判定 → 收起(回饋靠 combo/閃字)
        continue;
      }
      const arrival = v.note.tSec + judgeConfig.offsetSec;
      const pHead = (now - (arrival - flightTime)) / flightTime;
      const x = laneX(v.col);
      const y = rowY(v.row);
      if (v.note.kind === 'hold' && v.note.holdEndSec !== undefined) {
        const arrivalTail = v.note.holdEndSec + judgeConfig.offsetSec;
        const pTail = (now - (arrivalTail - flightTime)) / flightTime;
        const visible = pHead <= 1 && pTail >= 0;
        v.box.visible = v.sprite.visible = visible;
        if (visible) {
          const headZ = zAt(pHead);
          const tailZ = zAt(pTail);
          const len = Math.max(NOTE_SIZE, headZ - tailZ);
          v.box.position.set(x, y, (headZ + tailZ) / 2);
          v.box.scale.set(1, 1, len / NOTE_SIZE);
          v.sprite.position.set(x, y, headZ + 0.5);
        }
      } else {
        const visible = pHead >= 0 && pHead <= 1;
        v.box.visible = v.sprite.visible = visible;
        if (visible) {
          const z = zAt(pHead);
          v.box.position.set(x, y, z);
          v.box.scale.set(1, 1, 1);
          v.sprite.position.set(x, y, z + 0.5);
        }
      }
    }
  };

  let raf = 0;
  const loop = (ts: number) => {
    const now = player.positionSec;
    if (judger) {
      if (judger.expiry(now).length > 0) flash('miss'); // 過期未敲 → Miss
      showCombo();
    }
    const age = ts - flashStart; // 回饋閃字淡出
    flashEl.style.opacity = age < FLASH_MS ? String(1 - age / FLASH_MS) : '0';

    positionNotes(now);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };

  positionNotes(-Infinity); // 進場靜態畫面(格線),按下開始才播放並啟動迴圈
  renderer.render(scene, camera);

  // ── 輸入:遊玩中收 keydown,當場 press 給即時回饋 ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (!judger || !player.isPlaying || e.repeat) return;
    if (!(e.code in KEY_LAYOUT)) return;
    const outcome: PressOutcome = judger.press({ t: player.positionSec, key: e.code });
    if (outcome.kind !== 'extra') flash(outcome.kind);
    showCombo();
  };
  window.addEventListener('keydown', onKeyDown);

  // ── 控制 ──
  const startBtn = container.querySelector<HTMLButtonElement>('.bt-start')!;
  startBtn.addEventListener('click', () => {
    void (async () => {
      startBtn.style.display = 'none';
      judger = new Judger(chart, judgeConfig); // 每次開始重建 → 支援重玩
      if (player.positionSec >= player.duration) player.stop();
      await player.play(0);
      if (!raf) raf = requestAnimationFrame(loop);
    })();
  });

  const flightInput = container.querySelector<HTMLInputElement>('.bt-flight')!;
  const flightVal = container.querySelector<HTMLSpanElement>('.bt-flight-val')!;
  const offsetInput = container.querySelector<HTMLInputElement>('.bt-offset')!;
  const offsetVal = container.querySelector<HTMLSpanElement>('.bt-offset-val')!;
  flightInput.addEventListener('input', () => {
    flightTime = Number(flightInput.value);
    flightVal.textContent = `${flightTime.toFixed(2)}s`;
  });
  offsetInput.addEventListener('input', () => {
    judgeConfig.offsetSec = Number(offsetInput.value);
    offsetVal.textContent = `${judgeConfig.offsetSec >= 0 ? '+' : ''}${judgeConfig.offsetSec.toFixed(3)}s`;
  });

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    boxGeo.dispose();
    for (const v of visuals) {
      (v.box.material as THREE.Material).dispose();
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
function makeGlyphSprite(glyph: string, color = '#ffffff', scale = 0.85): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 88px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(glyph, size / 2, size / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

// ── 疊在畫布上的 HTML 控制列 ──
function buildControls(): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:absolute;left:0;top:0;right:0;display:flex;gap:16px;align-items:center;flex-wrap:wrap;' +
    'padding:10px 14px;font-family:system-ui,sans-serif;font-size:13px;color:#cdd3df;' +
    'background:linear-gradient(#0b0d12cc,#0b0d1200);z-index:2;';
  bar.innerHTML = `
    <button type="button" class="bt-start"
      style="font-size:15px;padding:8px 20px;cursor:pointer;border:0;border-radius:6px;background:#2e86d6;color:#fff;">
      ▶ 開始
    </button>
    <label style="display:flex;gap:6px;align-items:center;">飛行時間
      <input type="range" class="bt-flight" min="0.8" max="3" step="0.05" value="${FLIGHT_DEFAULT}" />
      <span class="bt-flight-val" style="width:44px;">${FLIGHT_DEFAULT.toFixed(2)}s</span>
    </label>
    <label style="display:flex;gap:6px;align-items:center;">offset
      <input type="range" class="bt-offset" min="-0.3" max="0.3" step="0.005" value="${OFFSET_DEFAULT}" />
      <span class="bt-offset-val" style="width:52px;">+0.000s</span>
    </label>`;
  return bar;
}

// ── combo 數(上方中央)+ 判定閃字(中央) ──
function buildFeedback(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;z-index:1;';
  wrap.innerHTML = `
    <div class="bt-combo" style="position:absolute;top:16%;left:0;right:0;text-align:center;
      font-size:34px;font-weight:800;color:#eef1f7;text-shadow:0 2px 8px #000;"></div>
    <div class="bt-flash" style="position:absolute;top:40%;left:0;right:0;text-align:center;
      font-size:44px;font-weight:900;opacity:0;text-shadow:0 2px 10px #000;"></div>`;
  return wrap;
}
