// 難度選擇畫面(issue 17):純 DOM 渲染 + 使用者互動事件,無跨畫面資料流轉決策。
// 難度檔內容快取/WPM 粗估/過去最佳成績查詢皆由呼叫端(流程編排層)算好餵入——見 docs/adr/0014:
// 「免重讀難度檔」是跨畫面生命週期的流程關注點,不屬單一畫面自己的渲染需求。
import type { DifficultyGroup } from '../compile/difficultyMenu.ts';
import { KEY_GROUPS, type DifficultyRef, type KeyGroup } from '../compile/types.ts';

/** 難度選畫用的鍵群顯示名;鍵群清單本身以 compile 的 KEY_GROUPS 為權威。 */
export const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  all: '全鍵',
  home: '家排',
  top: '上排',
  bottom: '下排',
  number: '數字排',
};

/** 單一難度的過去最佳成績,顯示就緒(由流程編排層算好:調整後準確率 + 達成鍵群)。 */
export interface DifficultyBestLabel {
  readonly pct: string; // 如 "67.0%"
  readonly keyGroupLabel: string;
}

export interface DifficultyScreenProps {
  readonly songName: string;
  readonly groups: readonly DifficultyGroup[];
  /** 難度檔名 → WPM 顯示字串(無資料或讀取失敗則為空字串)。 */
  readonly wpmLabel: ReadonlyMap<string, string>;
  /** 難度檔名 → 過去最佳(無紀錄則不在表中)。 */
  readonly bestLabel: ReadonlyMap<string, DifficultyBestLabel>;
  readonly initialKeyGroup: KeyGroup;
  readonly onKeyGroupChange: (group: KeyGroup) => void;
  readonly onPick: (diff: DifficultyRef) => void;
  readonly onBack: () => void;
}

/** 渲染難度選擇畫面:列出可玩難度(依特性分組)+ 訓練鍵群切換 + 每難度 WPM/過去最佳。 */
export function renderDifficultyScreen(root: HTMLElement, props: DifficultyScreenProps): void {
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
  root.querySelector<HTMLElement>('#bt-song')!.textContent = props.songName;
  const errorBox = root.querySelector<HTMLElement>('#bt-error')!;
  const groupsBox = root.querySelector<HTMLElement>('#bt-groups')!;

  // 鍵群選擇(issue 15):切換即回呼(持久化交給呼叫端)。
  const kgBox = root.querySelector<HTMLElement>('#bt-keygroup')!;
  let currentGroup: KeyGroup = props.initialKeyGroup;
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
        props.onKeyGroupChange(g);
        renderKeyGroups();
      });
      kgBox.appendChild(b);
    }
  };
  renderKeyGroups();

  const pick = (diff: DifficultyRef) => {
    errorBox.textContent = '';
    props.onPick(diff);
  };

  const showGroupHeader = props.groups.length > 1;
  for (const g of props.groups) {
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
      const wpmText = props.wpmLabel.get(d.filename) ?? '';
      if (wpmText) {
        const wpm = document.createElement('span');
        wpm.textContent = wpmText;
        wpm.style.cssText = 'color:#8b93a7;font-size:14px';
        left.appendChild(wpm);
      }
      // 右側:過去最佳,拆兩行——分數行大、模式(鍵群)行小。
      const rec = props.bestLabel.get(d.filename);
      const best = document.createElement('div');
      best.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;';
      if (rec) {
        const score = document.createElement('span');
        score.style.cssText = 'font-size:18px;font-weight:700;color:#78c2b5;line-height:1';
        score.textContent = `最佳 ${rec.pct}`;
        const mode = document.createElement('span');
        mode.style.cssText = 'font-size:12px;color:#8b93a7;line-height:1';
        mode.textContent = rec.keyGroupLabel;
        best.append(score, mode);
      }
      btn.append(left, best);
      btn.addEventListener('click', () => pick(d));
      groupsBox.appendChild(btn);
    }
  }

  root.querySelector<HTMLButtonElement>('#bt-back')!.addEventListener('click', () => props.onBack());
}
