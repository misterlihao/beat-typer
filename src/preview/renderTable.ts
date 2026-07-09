// 文字/表格預覽:把 TypingChart 印成「按鍵序列 + 時間點」表格,
// 附播放鈕與 playhead 高亮跟隨,供肉眼/耳朵驗證映射與音訊對拍(PRD story 9)。
import type { AudioPlayer } from '../audio/player.ts';
import { glyphOf } from '../compile/mapping.ts';
import type { Bank, Finger, Hand, TypingChart } from '../compile/types.ts';

export interface PreviewDeps {
  readonly title: string;
  readonly bpm: number;
  readonly songTimeOffset: number;
}

const HAND_LABEL: Record<Hand, string> = { left: '左手', right: '右手' };
const FINGER_LABEL: Record<Finger, string> = {
  pinky: '小指',
  ring: '無名',
  middle: '中指',
  index: '食指',
};
const BANK_LABEL: Record<Bank, string> = { top: '上', home: '家', bottom: '下' };

const STYLE = `
.bt-preview { font-family: system-ui, sans-serif; max-width: 860px; margin: 24px auto; color: #1a1a1a; }
.bt-preview h1 { font-size: 20px; margin: 0 0 4px; }
.bt-preview .bt-meta { color: #666; font-size: 13px; margin-bottom: 12px; }
.bt-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.bt-controls button { font-size: 15px; padding: 6px 16px; cursor: pointer; }
.bt-clock { font-variant-numeric: tabular-nums; color: #444; }
.bt-table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.bt-table th, .bt-table td { border: 1px solid #ddd; padding: 4px 10px; text-align: center; font-size: 14px; }
.bt-table th { background: #f4f4f4; }
.bt-glyph { font-weight: 700; font-size: 16px; }
.bt-left { color: #c0392b; } .bt-right { color: #2471a3; }
.bt-table tr.bt-current td { background: #fff3bf; }
@media (prefers-color-scheme: dark) {
  .bt-preview { color: #eaeaea; }
  .bt-preview .bt-meta, .bt-clock { color: #aaa; }
  .bt-table th { background: #2a2a2a; }
  .bt-table th, .bt-table td { border-color: #444; }
  .bt-left { color: #ff6b5e; } .bt-right { color: #6bb6ff; }
  .bt-table tr.bt-current td { background: #4a4327; }
}`;

/** 渲染預覽到 root。回傳清理函式(停止動畫迴圈)。 */
export function renderPreview(
  root: HTMLElement,
  chart: TypingChart,
  deps: PreviewDeps,
  player: AudioPlayer,
): () => void {
  const secPerBeat = 60 / deps.bpm;

  if (!document.getElementById('bt-preview-style')) {
    const style = document.createElement('style');
    style.id = 'bt-preview-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const container = document.createElement('div');
  container.className = 'bt-preview';

  const rowsHtml = chart
    .map((n, i) => {
      const beat = (n.tSec - deps.songTimeOffset) / secPerBeat;
      const handClass = n.hand === 'left' ? 'bt-left' : 'bt-right';
      return `<tr data-i="${i}" data-t="${n.tSec}">
        <td>${i + 1}</td>
        <td>${n.tSec.toFixed(3)}</td>
        <td>${Number.isInteger(beat) ? beat : beat.toFixed(2)}</td>
        <td class="bt-glyph ${handClass}">${escapeHtml(glyphOf(n.key))}</td>
        <td>${escapeHtml(n.key)}</td>
        <td class="${handClass}">${HAND_LABEL[n.hand]}</td>
        <td>${FINGER_LABEL[n.finger]}</td>
        <td>${BANK_LABEL[n.bank]}</td>
        <td>${n.kind}</td>
        <td>${n.holdEndSec === undefined ? '' : n.holdEndSec.toFixed(3)}</td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <h1>${escapeHtml(deps.title)}</h1>
    <div class="bt-meta">BPM ${deps.bpm} · offset ${deps.songTimeOffset}s · ${chart.length} 顆音符</div>
    <div class="bt-controls">
      <button type="button" class="bt-play">▶ 播放</button>
      <span class="bt-clock">0.000s</span>
    </div>
    <table class="bt-table">
      <thead><tr>
        <th>#</th><th>tSec</th><th>beat</th><th>字形</th><th>key(code)</th>
        <th>手</th><th>指</th><th>排</th><th>kind</th><th>holdEnd</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  root.replaceChildren(container);

  const playBtn = container.querySelector<HTMLButtonElement>('.bt-play')!;
  const clock = container.querySelector<HTMLSpanElement>('.bt-clock')!;
  const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));

  let currentRow: HTMLTableRowElement | null = null;
  let raf = 0;

  const updateHighlight = () => {
    const pos = player.positionSec;
    clock.textContent = `${pos.toFixed(3)}s`;
    // 高亮 tSec 最接近目前播放位置的音符。
    let nearest: HTMLTableRowElement | null = null;
    let best = Infinity;
    for (const row of rows) {
      const d = Math.abs(Number(row.dataset.t) - pos);
      if (d < best) {
        best = d;
        nearest = row;
      }
    }
    if (nearest !== currentRow) {
      currentRow?.classList.remove('bt-current');
      nearest?.classList.add('bt-current');
      nearest?.scrollIntoView({ block: 'nearest' });
      currentRow = nearest;
    }
  };

  const setLabel = () => {
    playBtn.textContent = player.isPlaying ? '⏸ 暫停' : '▶ 播放';
  };

  const loop = () => {
    updateHighlight();
    setLabel();
    if (player.isPlaying) {
      raf = requestAnimationFrame(loop);
    }
  };

  player.onEnded = () => {
    setLabel();
    updateHighlight();
  };

  playBtn.addEventListener('click', () => {
    void (async () => {
      if (player.isPlaying) {
        player.pause();
        setLabel();
      } else {
        if (player.positionSec >= player.duration) player.stop();
        await player.play();
        setLabel();
        raf = requestAnimationFrame(loop);
      }
    })();
  });

  return () => {
    cancelAnimationFrame(raf);
    player.onEnded = null;
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
