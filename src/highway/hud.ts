// 高速公路的 HUD / 覆蓋層 DOM 建構(純視圖殼,無真相邏輯):目標格線、字母 billboard、控制列、
// 暫停/結束覆蓋層、倒數過場、回饋文字、資訊卡。改版面 / 樣式不動遊戲邏輯。見 docs/adr/0014。
import * as THREE from 'three';
import { glyphOf } from '../compile/mapping.ts';
import { SETTINGS_SPEC, type Settings } from '../settings/settings.ts';
import { COLS, KEY_LAYOUT, LANE_SPACING, PLANE_Z, ROWS, ROW_SPACING, laneX, rowY } from './geometry.ts';

// ── 判定平面的靜態目標格線(10×3)+ 淡淡字母標籤,示意鍵盤與手指預備位。 ──
export function buildTargetGrid(): THREE.Group {
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
export function makeGlyphSprite(glyph: string, color = '#ffffff', scale = 0.85, onTop = false): THREE.Sprite {
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
// 預設隱藏,滑鼠靠近底部才淡入(暫停時固定顯示);由 startHighway 綁定顯隱。無「開始」鈕:進場自動倒數開跑。
export function buildControls(settings: Settings): HTMLElement {
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
  const li = SETTINGS_SPEC.lightIntensity;
  bar.innerHTML = `
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
    </label>
    <label style="display:flex;gap:6px;align-items:center;">燈光
      <input type="range" class="bt-light" min="${li.min}" max="${li.max}" step="${li.step}" value="${settings.lightIntensity}" />
      <span class="bt-light-val" style="width:40px;">${Math.round(settings.lightIntensity * 100)}%</span>
    </label>`;
  return bar;
}

// ── 暫停 / 結束覆蓋層(issue 13 + 09):半透明暗幕 + 標題 + 結算面板 + 繼續 / 重新開始 / 回選歌。 ──
// 結算面板(.bt-results)只在結束(ended)顯示、暫停時隱藏;數據由 startHighway 從 judger.summary() 填。
export function buildPauseOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'bt-overlay';
  overlay.style.cssText =
    'position:absolute;inset:0;display:none;place-items:center;z-index:5;' +
    'background:#0b0d12cc;font-family:system-ui,sans-serif;color:#eef1f7;';
  const btn = 'font-size:15px;padding:9px 22px;cursor:pointer;border:0;border-radius:8px;';
  overlay.innerHTML = `
    <div style="text-align:center;">
      <div class="bt-overlay-title" style="font-size:34px;letter-spacing:2px;margin-bottom:6px;">暫停中</div>
      <div class="bt-results" style="display:none;margin:2px 0 22px;">
        <div class="bt-grade-hero" style="font-size:96px;font-weight:900;line-height:1;
          text-shadow:0 4px 18px #000;transform-origin:50% 50%;"></div>
        <div class="bt-acc" style="font-size:38px;font-weight:800;color:#eef1f7;margin-top:2px;"></div>
        <div class="bt-fc" style="display:none;font-size:15px;font-weight:800;letter-spacing:2px;
          color:#ff6ec7;margin-top:8px;">⚡ FULL COMBO</div>
        <div class="bt-counts" style="font-size:17px;font-weight:700;margin-top:14px;"></div>
        <div class="bt-maxcombo" style="font-size:14px;color:#8b93a7;margin-top:8px;"></div>
        <div class="bt-best" style="display:none;font-size:13px;color:#8b93a7;
          margin-top:14px;border-top:1px solid #2a3040;padding-top:12px;"></div>
        <div class="bt-best-badge" style="display:none;font-size:14px;font-weight:800;
          color:#ff6ec7;margin-top:8px;">🏆 新紀錄!</div>
      </div>
      <div class="bt-overlay-hint" style="font-size:13px;color:#8b93a7;margin-bottom:26px;">Space / Esc 繼續</div>
      <div style="display:flex;gap:14px;justify-content:center;">
        <button type="button" class="bt-resume" style="${btn}background:#2e86d6;color:#fff;">繼續</button>
        <button type="button" class="bt-restart" style="${btn}background:#2b3040;color:#cdd3df;">重新開始</button>
        <button type="button" class="bt-exit" style="${btn}background:#2b3040;color:#cdd3df;">回選歌</button>
      </div>
    </div>`;
  return overlay;
}

// ── 倒數過場覆蓋層(統一前奏):置中大數字;z-index 高於控制列(6)與暫停層(5),蓋住整個畫面。 ──
export function buildCountdown(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bt-countdown';
  el.style.cssText =
    'position:absolute;inset:0;display:none;place-items:center;z-index:7;pointer-events:none;' +
    'background:#0b0d1299;font-family:system-ui,sans-serif;';
  el.innerHTML =
    `<div class="bt-count-num" style="font-size:160px;font-weight:900;color:#eef1f7;line-height:1;` +
    `text-shadow:0 6px 28px #000;transform-origin:50% 50%;"></div>`;
  return el;
}

// ── 頂部進度條 + 時間、combo(右上)、判定閃字(中央) ──
export function buildFeedback(): HTMLElement {
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
    <div class="bt-grade" style="position:absolute;right:20px;top:16px;
      font-size:60px;font-weight:800;opacity:0.95;text-shadow:0 2px 8px #000;
      text-align:right;line-height:1;"></div>
    <div class="bt-combo" style="position:absolute;right:20px;top:90px;
      font-size:40px;font-weight:800;color:#eef1f7;opacity:0.95;text-shadow:0 2px 8px #000;
      transform-origin:100% 50%;line-height:1;text-align:right;"></div>
    <div class="bt-flash" style="position:absolute;top:12%;left:0;right:0;text-align:center;
      font-size:44px;font-weight:900;opacity:0;text-shadow:0 2px 10px #000;"></div>
    <div class="bt-tailhint" style="position:absolute;left:0;right:0;top:42%;text-align:center;
      font-size:20px;font-weight:700;color:#eef1f7;letter-spacing:1px;text-shadow:0 2px 10px #000;
      opacity:0;transition:opacity .5s ease;"><span style="background:#12151dcc;
      border:1px solid #2a3040;border-radius:10px;padding:10px 20px;backdrop-filter:blur(3px);">♪ 沒有音符了 · 按 Space 結束</span></div>`;
  return wrap;
}

// ── 左上角譜面資訊卡:封面(缺圖→佔位)+ 歌名 + 難度,全程常駐。 ──
export function buildInfoCard(info: { songName: string; difficultyLabel: string; coverUrl?: string }): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'position:absolute;left:12px;top:12px;z-index:2;display:flex;gap:10px;align-items:center;' +
    'max-width:44%;padding:8px 12px 8px 8px;border-radius:10px;' +
    'background:#12151dcc;border:1px solid #2a3040;font-family:system-ui,sans-serif;' +
    'backdrop-filter:blur(3px);' +
    // 線性放大:整張卡等比 scale(1.5),原點左上以維持錨在 (12,12) 角落。
    'transform:scale(1.5);transform-origin:top left;';
  const cover = info.coverUrl
    ? `<img src="${info.coverUrl}" alt=""
         style="width:44px;height:44px;border-radius:6px;object-fit:cover;display:block;flex:0 0 auto;" />`
    : `<div style="width:44px;height:44px;border-radius:6px;flex:0 0 auto;display:flex;
         align-items:center;justify-content:center;font-size:22px;color:#8b93a7;
         background:linear-gradient(135deg,#2a3142,#1a1f2b);">♪</div>`;
  card.innerHTML = `
    ${cover}
    <div style="min-width:0;">
      <div title="${escapeAttr(info.songName)}" style="font-size:14px;font-weight:700;color:#eef1f7;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26ch;">${escapeHtml(info.songName)}</div>
      <div style="font-size:12px;color:#8b93a7;margin-top:2px;">${escapeHtml(info.difficultyLabel)}</div>
    </div>`;
  return card;
}

// 一次性注入 HUD 的 keyframes(combo 升級 pop)。多次呼叫只注入一次。
export function ensureHudStyle(): void {
  if (document.getElementById('bt-hud-style')) return;
  const style = document.createElement('style');
  style.id = 'bt-hud-style';
  style.textContent = `
    @keyframes bt-combo-pop { 0% { transform: scale(1.45); } 100% { transform: scale(1); } }
    .bt-combo.bt-pop { animation: bt-combo-pop 260ms cubic-bezier(.2,.9,.3,1); }
    @keyframes bt-grade-pop { 0% { transform: scale(1.8); opacity: 0; } 55% { opacity: 1; } 100% { transform: scale(1); } }
    .bt-grade-hero.bt-pop { animation: bt-grade-pop 420ms cubic-bezier(.2,.9,.3,1); }
    @keyframes bt-count-pop { 0% { transform: scale(1.6); opacity: 0; } 40% { opacity: 1; } 100% { transform: scale(1); opacity: .95; } }
    .bt-count-num.bt-pop { animation: bt-count-pop 900ms cubic-bezier(.2,.9,.3,1); }`;
  document.head.appendChild(style);
}

// 文字/屬性轉義(歌名可能含 < & " 等字元)。
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
