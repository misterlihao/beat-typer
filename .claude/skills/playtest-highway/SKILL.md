---
name: playtest-highway
description: 在真實瀏覽器中透過 chrome-devtools MCP 實跑並驗證 Beat Typer 的 3D 高速公路遊戲時使用——啟 dev server、截圖、以腳本自動打、確認音符飛行/判定(Perfect/Good/Miss)/combo/格子發光與按鍵音效等遊玩回饋是否正確,或確認某項遊玩/渲染/音訊改動在實際遊戲中生效。含關鍵時序陷阱與「音訊時鐘對齊」自動打技法。不適用於 compileChart / judge 等純函式的單元驗證(那用 vitest fixtures,不需開瀏覽器)。
---

# Playtest Highway — 在瀏覽器驗證 Beat Typer 遊戲

`compileChart` / `judge` 是純函式,用 vitest fixtures 驗;但 3D 高速公路、音同步、輸入判定、視覺/音效回饋只能**在瀏覽器實跑**才驗得到(慣例:不 mock Three.js/音訊)。這支技能是實跑的可靠劇本。

## 為什麼需要特別技法(核心陷阱)

**chrome-devtools 的 `click` 工具與你下一個 `evaluate` 之間有數秒牆鐘落差**(agent 回合延遲 + click 工具會等頁面 settle)。內建範例歌只有 ~4 秒,於是「按開始」後、你的自動打腳本還沒跑,歌就播完了 → `player.positionSec` 卡在 `duration`(=4)、`isPlaying=false`、輸入被 guard 擋掉 → 全部 MISS、`maxCombo:0`。

**這不是 app 的 bug,是驅動方式的問題。** 徵兆:`positionSec` 一開始就 =4、`pressedCount:0`、只有 MISS。

## 可靠作法:單一 evaluate 內完成 + 音訊時鐘對齊

- **DEV hook**:main.ts 在 `import.meta.env.DEV` 下掛 `window.__btPlayer`(即 AudioPlayer),提供 `positionSec` / `isPlaying` / `duration`。dev server 才有,正式建置不掛。
- **在同一個 `evaluate` 裡**:等 `__btPlayer` 與 `.bt-start` 就緒 → 程式點 `.bt-start`(localhost 已有互動,AudioContext 可 resume)→ 等 `isPlaying` → 用**真實 `positionSec`** 對齊,當 `positionSec >= note.tSec` 時 `dispatchEvent(new KeyboardEvent('keydown',{code}))`。**不要**用 `setTimeout(tSec*1000)` 按牆鐘排程——那與音訊時鐘有未知偏移,會全 MISS。
- **spam 是安全的保證命中法**:多餘按鍵在本作**完全不罰**(不斷 combo、不扣準確率),所以在某鍵的時間窗附近多按幾次一定命中、無副作用。
- **截圖抓瞬時效果**(格子發光僅 ~260ms):在 evaluate 裡設 `setInterval` 持續按鍵並**立即 return**,同一則訊息接著 `take_screenshot`,即可捕捉發光那一幀。

### 自動打骨架(全連驗證,回傳 `{maxCombo:8, flashes:['PERFECT'], pressedCount:8}` 代表 OK)
```js
async () => {
  const waitFor = async (c,ms)=>{for(let i=0;i*30<ms;i++){if(c())return true;await new Promise(r=>setTimeout(r,30));}return false;};
  await waitFor(()=>Reflect.get(window,'__btPlayer')&&document.querySelector('.bt-start'),4000);
  const p = Reflect.get(window,'__btPlayer');
  document.querySelector('.bt-start').click();
  if(!await waitFor(()=>p.isPlaying,1500)) return {error:'audio blocked'};
  const seq=[[0.05,'KeyF'],[0.55,'KeyD'],[1.05,'KeyR'],[1.55,'KeyE'],[2.05,'KeyJ'],[2.55,'KeyK'],[3.05,'KeyU'],[3.55,'KeyI']];
  const pressed=new Set(),flashes=new Set(); let maxCombo=0;
  const comboEl=document.querySelector('.bt-combo'),flashEl=document.querySelector('.bt-flash');
  for(let i=0;i<600;i++){const pos=p.positionSec;
    for(const [t,code] of seq) if(!pressed.has(code)&&pos>=t&&pos<=t+0.04){window.dispatchEvent(new KeyboardEvent('keydown',{code}));pressed.add(code);}
    const m=/(\d+) combo/.exec(comboEl?.textContent||''); if(m)maxCombo=Math.max(maxCombo,+m[1]);
    const f=(flashEl?.textContent||'').trim(); if(f)flashes.add(f);
    if(pos>=3.7)break; await new Promise(r=>setTimeout(r,8));
  }
  return {maxCombo,flashes:[...flashes],pressedCount:pressed.size};
}
```

## 流程

1. `npm run dev`(背景),從輸出抓 `http://localhost:<PORT>/`——**port 會變**(5173 被占就跳 5174/5175…),別寫死。
2. `new_page` 開該 URL;`take_snapshot` 取得 `▶ 開始` 的 uid。
3. 靜態畫面先截圖:應見判定平面的 **10 欄 × 3 列鍵盤格線 + 字母**(QWERTYUIOP / ASDFGHJKL; / ZXCVBNM,./)透視收斂朝消失點。
4. 用上面的自動打 evaluate 驗證遊玩;或程式點開始 + `setInterval` spam + 立即截圖來看飛行/發光。
5. 收尾:`pkill -f vite`(或關背景行程)。

## 觀察點(該看到什麼)

- 音符從遠端(近消失點、小)沿 −Z 飛到判定平面對應格(近、大);字母 billboard 恆正面。
- 顏色:左手紅、右手藍。落點格 = 該鍵在鍵盤上的 (左右欄, 上下列)。
- 命中:該格發光(**金=Perfect、綠=Good、紅=Miss/錯鍵、中性藍灰=多餘**)、中央閃 PERFECT/GOOD/MISS、combo 累加。
- 音效:清脆 tick(**高音=Perfect、低沉=其他**)。
- `list_console_messages` 應無 error。

## 內建範例參考(golden)

8 顆、~4 秒:左手 `F D R E` @ tSec 0.05/0.55/1.05/1.55(code `KeyF/KeyD/KeyR/KeyE`);右手 `J K U I` @ 2.05/2.55/3.05/3.55(`KeyJ/KeyK/KeyU/KeyI`)。全連 → maxCombo 8。
> 註:鍵由鍵指派依教學權重選(見 docs/adr/0008),非舊的位置映射;映射若再改,這組 golden 也要跟著更新。
