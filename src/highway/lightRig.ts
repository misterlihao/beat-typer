// 燈光 sink(薄渲染層,issue 24):消費 compileLightShow 的 LightShow,把標準化燈光時間線演成
// 「朝玩家的自發光燈」。發光體本身即可見物(additive glow sprite),不需受光面 → 不依賴場景(issue 20)。
//
// 資料驅動:數 LightShow 實際出現幾個色燈組,就程序化生等量發光體,鋪在周邊拱形、避開中央讀字區。
// 無燈光資料 → 兩顆預設淡紅藍發光體做緩慢正弦呼吸(不綁拍)。時間對齊用音訊時鐘(nowSec),與音符同基準。
// 判定邏輯 / 遊戲狀態不在此;此層只讀時間、畫光。
import * as THREE from 'three';
import type { LightEvent, LightShow } from '../compile/lightShow.ts';

// ── 動畫常數(實跑微調)──
const FLASH_DECAY_SEC = 0.35; // flash 尖峰衰減回常亮的時長
const FLASH_PEAK_MUL = 1.8; // flash 尖峰相對常亮的倍率
const FADE_DECAY_SEC = 0.9; // fade 由常亮衰減到 0 的時長
const BREATHE_PERIOD_SEC = 7; // 無資料呼吸週期
// 呼吸只有 2 顆不重疊的燈,故基準/振幅設得比事件燈高,經 MASTER_GAIN 後仍溫和可辨(不頻閃)。
const BREATHE_BASE = 0.4; // 呼吸基準亮度
const BREATHE_AMP = 0.28; // 呼吸振幅
const MASTER_GAIN = 0.42; // 發光體總增益:壓低 additive 累加,避免多顆重疊爆白(實跑微調)
const WASH_FACTOR = 0.12; // 背景 / fog 向燈色染色的最大比例(克制,不搶讀字、不洗灰全場)
const GLOW_SCALE = 5.5; // 發光體 sprite 大小(世界單位)
const EMITTER_Z = -24; // 發光體深度(遠端、在霧內,讀作舞台燈)
const SEEK_BACK_EPS = 0.05; // 時鐘倒退(重玩)判定門檻

// 預設淡紅藍(偏淡偏暗):無燈光資料時的呼吸色。
const BREATHE_LEFT = { r: 0.5, g: 0.22, b: 0.26 };
const BREATHE_RIGHT = { r: 0.26, g: 0.38, b: 0.58 };

interface Emitter {
  readonly sprite: THREE.Sprite;
  readonly color: THREE.Color; // 目前色(事件套用時更新;呼吸體固定)
  readonly breathePhase: number; // 呼吸相位(只呼吸體用)
  action: 'off' | 'on' | 'flash' | 'fade';
  brightness: number; // 目標亮度(事件的 brightness)
  startSec: number; // 目前動作起始時刻
}

export interface LightRig {
  /** 每幀呼叫:nowSec=音訊時鐘,intensity=使用者燈光強度(0=關)。 */
  update(nowSec: number, intensity: number): void;
  /** 卸載:移除發光體、還原場景背景 / fog、釋放 GPU 資源。 */
  dispose(): void;
}

export interface LightRigOptions {
  /** 場景 fog(染色時連帶調整,讓遠端音符與背景一致);可無。只需 color 欄位(Fog / FogExp2 皆符)。 */
  readonly fog: { color: THREE.Color } | null;
  /** 鍵盤格半寬(世界單位),決定發光體往兩側鋪多遠(避開中央)。 */
  readonly halfWidth: number;
}

/** 產生柔邊放射狀 glow 貼圖(白心→透明邊),供 additive sprite 當光暈。 */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** 拱形佈局第 i / n 顆發光體的位置:沿頂部周邊鋪開、中間高兩側低,z 在遠端。 */
function layoutAt(i: number, n: number, halfWidth: number): THREE.Vector3 {
  const t = n <= 1 ? 0.5 : i / (n - 1); // 0..1
  const spanX = halfWidth + 5; // 鋪到鍵盤格外側,避開中央讀字區
  const x = THREE.MathUtils.lerp(-spanX, spanX, t);
  const y = 6.5 + 2.5 * Math.sin(t * Math.PI); // 拱形:抬到讀字區上方,中間更高
  return new THREE.Vector3(x, y, EMITTER_Z);
}

/**
 * 建立燈光 rig。發光體由 lightShow 實際出現的色燈組數決定(空 → 2 顆呼吸體)。
 * @param scene 掛載場景
 * @param lightShow 標準化燈光時間線(compileLightShow 產出)
 * @param opts fog / 幾何參數
 */
export function createLightRig(scene: THREE.Scene, lightShow: LightShow, opts: LightRigOptions): LightRig {
  const glowTex = makeGlowTexture();
  const events = lightShow; // 已依 tSec 排序
  const breatheMode = events.length === 0;

  // 資料驅動:蒐集實際出現的色燈組;空則用 2 顆呼吸體。
  const groups = breatheMode ? [] : [...new Set(events.map((e) => e.group))].sort((a, b) => a - b);
  const n = breatheMode ? 2 : groups.length;

  const emitters: Emitter[] = [];
  const byGroup = new Map<number, Emitter>();
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0x000000, // 起始熄(additive:黑=不加光)
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false, // 自發光,不受距離霧壓暗
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(layoutAt(i, n, opts.halfWidth));
    sprite.scale.set(GLOW_SCALE, GLOW_SCALE, 1);
    scene.add(sprite);
    const init = breatheMode ? (i === 0 ? BREATHE_LEFT : BREATHE_RIGHT) : { r: 0, g: 0, b: 0 };
    const emitter: Emitter = {
      sprite,
      color: new THREE.Color(init.r, init.g, init.b),
      breathePhase: i === 0 ? 0 : Math.PI, // 兩顆呼吸體反相,交替起伏
      action: 'off',
      brightness: 0,
      startSec: -Infinity,
    };
    emitters.push(emitter);
    if (!breatheMode) byGroup.set(groups[i]!, emitter);
  }

  // 背景 / fog 染色:記下基準色,dispose 時還原。設 scene.background 讓虛空也隨燈色呼吸。
  const fog = opts.fog;
  const baseFog = fog ? fog.color.clone() : null;
  const prevBackground = scene.background;
  const baseBg = fog ? fog.color.clone() : new THREE.Color(0x0b0d12);
  scene.background = baseBg.clone();
  const washColor = new THREE.Color();
  const bgWork = new THREE.Color();

  let cursor = 0;
  let lastNow = -Infinity;

  const applyEvent = (ev: LightEvent) => {
    const em = byGroup.get(ev.group);
    if (!em) return;
    em.color.setRGB(ev.color.r, ev.color.g, ev.color.b);
    em.action = ev.action;
    em.brightness = ev.brightness;
    em.startSec = ev.tSec;
  };

  const levelOf = (em: Emitter, nowSec: number): number => {
    const base = em.brightness;
    const el = nowSec - em.startSec;
    switch (em.action) {
      case 'off':
        return 0;
      case 'on':
        return base;
      case 'flash':
        if (el >= FLASH_DECAY_SEC) return base;
        return base * (1 + (FLASH_PEAK_MUL - 1) * (1 - el / FLASH_DECAY_SEC));
      case 'fade':
        if (el >= FADE_DECAY_SEC) return 0;
        return base * (1 - el / FADE_DECAY_SEC);
    }
  };

  const breatheLevel = (em: Emitter, nowSec: number): number =>
    BREATHE_BASE + BREATHE_AMP * (0.5 + 0.5 * Math.sin((nowSec / BREATHE_PERIOD_SEC) * Math.PI * 2 + em.breathePhase));

  return {
    update(nowSec: number, intensity: number): void {
      // 時鐘倒退(重玩)→ 游標與各組狀態歸零。
      if (nowSec < lastNow - SEEK_BACK_EPS) {
        cursor = 0;
        for (const em of emitters) {
          em.action = 'off';
          em.brightness = 0;
          em.startSec = -Infinity;
        }
      }
      lastNow = nowSec;

      if (!breatheMode) {
        while (cursor < events.length && events[cursor]!.tSec <= nowSec) applyEvent(events[cursor++]!);
      }

      // 逐發光體算亮度、套 additive 色(色×亮度×強度×總增益);同時累積背景 wash。
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accW = 0;
      for (const em of emitters) {
        const level = breatheMode ? breatheLevel(em, nowSec) : levelOf(em, nowSec);
        const v = Math.max(0, level) * intensity * MASTER_GAIN;
        (em.sprite.material as THREE.SpriteMaterial).color.setRGB(em.color.r * v, em.color.g * v, em.color.b * v);
        accR += em.color.r * v;
        accG += em.color.g * v;
        accB += em.color.b * v;
        accW += v;
      }

      // 背景 / fog 向燈色染色(克制):以「平均」燈亮而非加總,避免燈組多時把全場洗灰。
      // fog 連帶染色 → 遠端方塊也吸到一點環境燈色,整體氛圍較融合(實跑比較後採此)。
      if (accW > 0) {
        washColor.setRGB(accR / accW, accG / accW, accB / accW);
        const avg = accW / emitters.length; // 平均每顆燈亮度(0..~1)
        bgWork.copy(baseBg).lerp(washColor, WASH_FACTOR * Math.min(1, avg));
      } else {
        bgWork.copy(baseBg);
      }
      (scene.background as THREE.Color).copy(bgWork);
      if (fog && baseFog) fog.color.copy(bgWork);
    },

    dispose(): void {
      for (const em of emitters) {
        scene.remove(em.sprite);
        (em.sprite.material as THREE.SpriteMaterial).dispose();
      }
      glowTex.dispose();
      scene.background = prevBackground;
      if (fog && baseFog) fog.color.copy(baseFog);
    },
  };
}
