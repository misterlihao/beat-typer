// 燈光 sink(薄渲染層,issue 24):消費 compileLightShow 的 LightShow,把標準化燈光時間線演成
// 「朝玩家的自發光燈」。發光體本身即可見物(additive glow sprite),不需受光面 → 不依賴場景(issue 20)。
//
// 資料驅動:數 LightShow 實際出現幾個色燈組,就程序化生等量發光體,鋪在周邊拱形、避開中央讀字區。
// 無燈光資料 → 兩顆預設淡紅藍發光體做緩慢正弦呼吸(不綁拍)。時間對齊用音訊時鐘(nowSec),與音符同基準。
// 判定邏輯 / 遊戲狀態不在此;此層只讀時間、畫光。
//
// 每個色燈組各自維護一條(依 tSec 遞增的)事件序列與游標;某時刻的顯示狀態:
//   - 若「下一筆」是 transition(值 4/8/12):在本筆→下一筆的時距內,由本筆穩態 lerp 到下一筆目標(顏色+亮度)。
//     連續 transition 即形成平滑脈動(BSMG 語意:transition 是「前一筆→本筆」的補間)。
//   - 否則:依本筆自身動作演出(on 維持 / flash 尖峰衰減回常亮 / fade 常亮衰減到 0 / off 熄)。
import * as THREE from 'three';
import type { LightColor, LightEvent, LightShow } from '../compile/lightShow.ts';

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
const MAX_TRANSITION_SEC = 4; // transition 補間的最長時距(過長的間隔不硬 lerp,避免整首緩慢漂移)

// 預設淡紅藍(偏淡偏暗):無燈光資料時的呼吸色。
const BREATHE_LEFT: LightColor = { r: 0.5, g: 0.22, b: 0.26 };
const BREATHE_RIGHT: LightColor = { r: 0.26, g: 0.38, b: 0.58 };

interface Emitter {
  readonly sprite: THREE.Sprite;
  readonly events: readonly LightEvent[]; // 本組事件(依 tSec 遞增);呼吸體為空
  readonly breatheColor: LightColor; // 呼吸體固定色(僅呼吸模式用)
  readonly breathePhase: number; // 呼吸相位(僅呼吸體用)
  idx: number; // 目前生效事件(tSec ≤ now 的最後一筆)索引;-1 = 尚未有事件
}

export interface LightRig {
  /** 每幀呼叫:nowSec=音訊時鐘,intensity=使用者燈光強度(0=關)。 */
  update(nowSec: number, intensity: number): void;
  /** 卸載:移除發光體、還原場景背景 / fog、釋放 GPU 資源。 */
  dispose(): void;
  /** DEV playtest 用:回傳各發光體目前顯示亮度(材質色最大分量),供數值驗證平滑度。 */
  debugLevels(): number[];
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

/** 某事件的「穩態亮度」:transition 的補間源、非 transition 段的常亮基準。off→0。 */
function steadyLevel(ev: LightEvent): number {
  return ev.action === 'off' ? 0 : ev.brightness;
}

/**
 * 建立燈光 rig。發光體由 lightShow 實際出現的色燈組數決定(空 → 2 顆呼吸體)。
 * @param scene 掛載場景
 * @param lightShow 標準化燈光時間線(compileLightShow 產出)
 * @param opts fog / 幾何參數
 */
export function createLightRig(scene: THREE.Scene, lightShow: LightShow, opts: LightRigOptions): LightRig {
  const glowTex = makeGlowTexture();
  const breatheMode = lightShow.length === 0;

  // 資料驅動:把事件依色燈組分桶(各桶已隨 lightShow 保持 tSec 遞增);空則用 2 顆呼吸體。
  const groups = breatheMode ? [] : [...new Set(lightShow.map((e) => e.group))].sort((a, b) => a - b);
  const n = breatheMode ? 2 : groups.length;
  const byGroup = new Map<number, LightEvent[]>();
  if (!breatheMode) {
    for (const g of groups) byGroup.set(g, []);
    for (const e of lightShow) byGroup.get(e.group)!.push(e);
  }

  const emitters: Emitter[] = [];
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
    emitters.push({
      sprite,
      events: breatheMode ? [] : byGroup.get(groups[i]!)!,
      breatheColor: i === 0 ? BREATHE_LEFT : BREATHE_RIGHT,
      breathePhase: i === 0 ? 0 : Math.PI, // 兩顆呼吸體反相,交替起伏
      idx: -1,
    });
  }

  // 背景 / fog 染色:記下基準色,dispose 時還原。設 scene.background 讓虛空也隨燈色呼吸。
  const fog = opts.fog;
  const baseFog = fog ? fog.color.clone() : null;
  const prevBackground = scene.background;
  const baseBg = fog ? fog.color.clone() : new THREE.Color(0x0b0d12);
  scene.background = baseBg.clone();
  const washColor = new THREE.Color();
  const bgWork = new THREE.Color();

  let lastNow = -Infinity;

  // 呼吸模式亮度(正弦,不綁拍)。
  const breatheLevel = (em: Emitter, nowSec: number): number =>
    BREATHE_BASE + BREATHE_AMP * (0.5 + 0.5 * Math.sin((nowSec / BREATHE_PERIOD_SEC) * Math.PI * 2 + em.breathePhase));

  // 事件模式:算某發光體在 nowSec 的顯示色與亮度(寫入 outColor,回傳 level)。
  const outColor = new THREE.Color();
  const eventState = (em: Emitter, nowSec: number): number => {
    // 游標前進到「tSec ≤ now 的最後一筆」。
    while (em.idx + 1 < em.events.length && em.events[em.idx + 1]!.tSec <= nowSec) em.idx++;
    if (em.idx < 0) {
      outColor.setRGB(0, 0, 0);
      return 0; // 首筆之前:全熄
    }
    const cur = em.events[em.idx]!;
    const next = em.events[em.idx + 1];

    // 下一筆是 transition → 在本筆穩態與下一筆目標之間 lerp(顏色 + 亮度)。
    if (next && next.action === 'transition') {
      const span = next.tSec - cur.tSec;
      const p = span > 0 && span <= MAX_TRANSITION_SEC ? Math.min(1, Math.max(0, (nowSec - cur.tSec) / span)) : 0;
      const fromLevel = steadyLevel(cur);
      const level = fromLevel + (next.brightness - fromLevel) * p;
      // 本筆熄燈時補間源色無意義,直接用目標色,避免低亮度下的怪色偏。
      const from = cur.action === 'off' ? next.color : cur.color;
      outColor.setRGB(
        from.r + (next.color.r - from.r) * p,
        from.g + (next.color.g - from.g) * p,
        from.b + (next.color.b - from.b) * p,
      );
      return level;
    }

    // 否則:依本筆自身動作演出。
    outColor.setRGB(cur.color.r, cur.color.g, cur.color.b);
    const base = cur.brightness;
    const el = nowSec - cur.tSec;
    switch (cur.action) {
      case 'off':
        return 0;
      case 'flash':
        return el >= FLASH_DECAY_SEC ? base : base * (1 + (FLASH_PEAK_MUL - 1) * (1 - el / FLASH_DECAY_SEC));
      case 'fade':
        return el >= FADE_DECAY_SEC ? 0 : base * (1 - el / FADE_DECAY_SEC);
      // on 與「已抵達的 transition」:維持穩態。
      default:
        return base;
    }
  };

  return {
    update(nowSec: number, intensity: number): void {
      // 時鐘倒退(重玩)→ 各組游標歸零。
      if (nowSec < lastNow - SEEK_BACK_EPS) {
        for (const em of emitters) em.idx = -1;
      }
      lastNow = nowSec;

      // 逐發光體算色與亮度、套 additive 色(色×亮度×強度×總增益);同時累積背景 wash。
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accW = 0;
      for (const em of emitters) {
        let level: number;
        if (breatheMode) {
          level = breatheLevel(em, nowSec);
          outColor.setRGB(em.breatheColor.r, em.breatheColor.g, em.breatheColor.b);
        } else {
          level = eventState(em, nowSec);
        }
        const v = Math.max(0, level) * intensity * MASTER_GAIN;
        (em.sprite.material as THREE.SpriteMaterial).color.setRGB(outColor.r * v, outColor.g * v, outColor.b * v);
        accR += outColor.r * v;
        accG += outColor.g * v;
        accB += outColor.b * v;
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

    debugLevels(): number[] {
      return emitters.map((em) => {
        const c = (em.sprite.material as THREE.SpriteMaterial).color;
        return Math.round(Math.max(c.r, c.g, c.b) * 1000) / 1000;
      });
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
