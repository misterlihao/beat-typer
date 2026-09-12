// 著陸畫面:拖放 zip / 點擊選檔 / 玩內建範例 / BSR 代號下載,四路都經 onRun 交給流程編排層。
// 最近清單與資料備份是本畫面自足的區塊(不與其他畫面共享狀態),故直接持有其 I/O;
// 免重讀難度檔的快取才是跨畫面流程關注點,不在本畫面——見 docs/adr/0014。
import { exportBackup, importBackup, type ImportMode } from '../backup/backup.ts';
import { BsrChartSource, parseBsrCode } from '../loader/bsr.ts';
import { BuiltinChartSource } from '../loader/builtin.ts';
import { loadRecentBsr, togglePinnedRecentBsr } from '../loader/recentBsr.ts';
import type { ChartSource } from '../loader/types.ts';
import { ZipChartSource } from '../loader/zip.ts';
import { loadScores } from '../scores/scores.ts';

export interface LandingScreenProps {
  readonly errorMessage?: string;
  /** 選定來源(zip / BSR / 內建範例)後交給流程編排層跑 bootstrap;失敗時由呼叫端重繪本畫面帶錯誤。 */
  readonly onRun: (source: ChartSource) => void;
}

/** 渲染著陸畫面。載入失敗時就地顯示紅字錯誤、拖放區保留,可直接再拖下一個 zip(見 docs/adr/0007)。 */
export function renderLandingScreen(app: HTMLElement, props: LandingScreenProps): void {
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
      <div style="border-top:1px solid #2a303c;margin-top:26px;padding-top:16px">
        <div style="font-size:12px;color:#8b93a7;margin:0 0 10px">資料備份(換裝置搬移)</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button id="bt-export" type="button"
            style="font-size:13px;padding:7px 14px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#161a24;color:#cdd3df">
            匯出備份
          </button>
          <button id="bt-import-merge" type="button"
            style="font-size:13px;padding:7px 14px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#161a24;color:#cdd3df">
            合併匯入
          </button>
          <button id="bt-import-replace" type="button"
            style="font-size:13px;padding:7px 14px;cursor:pointer;border:1px solid #4a5163;border-radius:8px;background:#161a24;color:#cdd3df">
            覆蓋匯入
          </button>
        </div>
        <div id="bt-backup-msg" style="min-height:20px;margin-top:10px;font-size:13px;white-space:pre-wrap"></div>
      </div>
      <input id="bt-file" type="file" accept=".zip"
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);border:0" />
      <input id="bt-backup-file" type="file" accept=".json,application/json"
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);border:0" />
    </div>`;

  const drop = app.querySelector<HTMLElement>('#bt-drop')!;
  const fileInput = app.querySelector<HTMLInputElement>('#bt-file')!;
  const sampleBtn = app.querySelector<HTMLButtonElement>('#bt-sample')!;
  const bsrInput = app.querySelector<HTMLInputElement>('#bt-bsr')!;
  const bsrGo = app.querySelector<HTMLButtonElement>('#bt-bsr-go')!;
  const errorBox = app.querySelector<HTMLElement>('#bt-error')!;
  if (props.errorMessage) errorBox.textContent = `載入失敗:${props.errorMessage}`;

  const run = (source: ChartSource, busyText = '載入中…') => {
    drop.querySelector('div')!.textContent = busyText;
    errorBox.textContent = '';
    props.onRun(source);
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

  // 資料備份(issue 26):匯出下載 .json;合併 / 覆蓋匯入各自選檔。覆蓋為破壞性 → 先 confirm。
  // parse / 認檔 / salvage 全在 backup 純函式;此處只搬檔案文字與呈現結果。
  const backupMsg = app.querySelector<HTMLElement>('#bt-backup-msg')!;
  const backupFile = app.querySelector<HTMLInputElement>('#bt-backup-file')!;
  let importMode: ImportMode = 'merge';
  app.querySelector<HTMLButtonElement>('#bt-export')!.addEventListener('click', () => {
    backupMsg.textContent = '';
    exportBackup();
  });
  const beginImport = (mode: ImportMode) => {
    importMode = mode;
    backupMsg.textContent = '';
    backupFile.value = ''; // 清空才能重選同一檔
    backupFile.click();
  };
  app.querySelector<HTMLButtonElement>('#bt-import-merge')!.addEventListener('click', () => beginImport('merge'));
  app.querySelector<HTMLButtonElement>('#bt-import-replace')!.addEventListener('click', () => beginImport('replace'));
  backupFile.addEventListener('change', () => {
    const file = backupFile.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      // 覆蓋為破壞性:執行前二次確認(顯示將被取代的成績筆數)。
      if (importMode === 'replace') {
        const n = Object.keys(loadScores().records).length;
        if (!confirm(`覆蓋匯入會取代現有 ${n} 筆成績與所有設定,確定?`)) return;
      }
      const result = importBackup(text, importMode);
      if (result.ok) {
        backupMsg.style.color = '#78c2b5';
        backupMsg.textContent = `已匯入:成績 ${result.scoreCount} 筆、最近 ${result.recentCount} 筆`;
        renderRecent(); // 最近清單即時反映
      } else {
        backupMsg.style.color = '#e05656';
        backupMsg.textContent = `匯入失敗:${result.reason}`;
      }
    });
  });

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
