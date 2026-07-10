# 12 — 設定持久化到 localStorage

> 來源:使用者需求——校準/偏好設定每次載入都歸零,得重調很煩。

## 問題

高速公路的三個設定目前只活在記憶體(highway.ts 區域狀態 + HTML `value` 寫死預設),重整頁面或換譜就重置:

- **飛行時間**(`flightTime`,0.8–3s,預設 1.75)——玩家反應時間偏好。
- **offset**(`judgeConfig.offsetSec`,−0.3–0.3s,預設 0)——裝置音訊/顯示延遲校準。
- **按鍵音量**(`player.tickVolume`,0–1,預設 0.3)。

三者都是**跨譜、跨場的玩家偏好/校準**(非單譜屬性),適合全域持久化。

## What to build

一個薄設定層(如 `src/settings/`,非純函式接縫、不碰 compileChart/judge)封裝 localStorage 讀寫:

- 啟動時讀持久設定,拿來當滑桿初值(取代寫死的 `FLIGHT_DEFAULT` 等);缺值用預設。
- 三個滑桿 `input` 時寫回 localStorage(單一 JSON blob,如鍵 `beat-typer:settings`)。
- **健壯性**:localStorage 不可用 / 空 / 壞 JSON / 欄位缺漏 → 靜默回退預設,不崩。
- **夾範圍**:讀到超出滑桿 min/max 的值(手動竄改)→ 夾回合法區間。

I/O / 渲染仍薄層;純函式接縫完全不受影響、不引入 localStorage 相依。

## Acceptance criteria

- [ ] 調整飛行時間/offset/音量後重整頁面或重新載入譜面,三值皆保留
- [ ] localStorage 空 → 用預設值且正常啟動;壞 JSON / 缺欄位 → 回退預設不崩
- [ ] 竄改成超範圍值 → 夾回滑桿合法區間
- [ ] 設定層與 compileChart / judge 解耦;二者不 import 也不觸及 localStorage
- [ ] 三滑桿初值來自持久設定(不再由 HTML 寫死),顯示文字同步

## Blocked by / 關聯

- 無阻擋(highway 設定已存在)。
- 與 issue 05 的 IndexedDB「資料夾 handle 持久化」不同機制、各管各的(那是授權 handle,這是偏好純值)。

## Out of scope

- 單譜專屬設定(所有設定皆全域)。
- 雲端同步 / 帳號。
- 記住「上次玩的譜/難度」(屬 05 選單範疇,非本 issue)。
