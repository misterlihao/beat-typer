# 24 — Beat Saber 譜面燈光效果轉換(第一階段:經典事件模型)

> 來源:使用者需求(2026-07-12 backlog);方向於 2026-07-13 grill 收斂。
> **狀態:已 grill,規格定案,待實作。** 新版 v3 燈光(`lightColorEventBoxGroups`)另開 **issue 24b**,不在本階段。

## 問題 / 動機

Beat Saber 譜面除了音符,還帶燈光 / 事件資料,原作靠它做全場燈光秀、與音樂同步。本作場景目前靜態。把譜面燈光轉成本作的視覺律動,讓畫面跟著音樂呼吸,大幅提升沉浸感,且資料已在譜裡。

## 定案設計(grill 2026-07-13)

### 接哪一層
- **獨立純函式 `compileLightShow(rawMapFiles, difficultyName) → LightShow`**,與 `compileChart` 並列,共用 `parseInfo` 與 `buildBeatToSec`(issue 10)。
- **不塞進 compileChart**:燈光與 TypingChart 正交(不影響音符 / 判定 / 計分),硬塞會把主接縫回傳撐成 `{chart, lightShow}`、污染所有呼叫端。獨立函式保住「解析 + beat→秒在 compile 層、純函式可測」的紀律,又不動主接縫。
- 渲染層(highway)只**消費** LightShow,不解析原始格式、不做時間換算。

### 燈光打在哪(sink)
- **朝玩家的自發光燈**:發光體本身即可見物(emissive 光帶 / 遠端 glow / 邊角色洗),**不需受光面**,因此**不依賴 issue 20 場景**,可獨立交付。
- **不還原原作舞台**:不同環境燈組數量 / 語意都不同。改為**資料驅動**——數譜面實際出現幾個「色燈組」就程序化生幾個發光體,對稱鋪在**周邊 / 遠端,避開中央判定與讀字區**(保護打字判讀)。
- 排除旋轉 / 轉速偽燈組(`et` 8 / 12 / 13:環旋轉、雷射轉速——其值是旋轉量非顏色)。

### 涵蓋範圍(本階段)
- **只做經典事件模型**:v2 `_events`(`{_time, _type, _value, _floatValue, _customData}`)+ v3 `basicBeatmapEvents`(`{b, et, i, f, customData}`)。亮度浮點 v2=`_floatValue`、v3=`f`,兩者都認。
- 色燈組 = `et` 0~4(後方 / 環 / 左雷射 / 右雷射 / 中央),扣掉旋轉 / 轉速類。
- **新版 `lightColorEventBoxGroups` → issue 24b**(巢狀 event-box-group,複雜好幾個量級)。
- 只有新版燈光的譜(如 overdose)本階段退化為 idle 呼吸(見下)。

### 顏色解析鏈(從譜讀,退化才用預設)
每個燈事件的顏色依序解:
1. **逐事件 Chroma**:事件 `_customData._color = [r,g,b,a]`(RGB 0..1,**第 4 位 a 為強度、可 >1 HDR**,需夾 / 縮到本作亮度範圍)。忽略同層 `_lightID`(燈組內單顆燈定址,超出「一組一發光體」範圍)。
2. **每難度 env 覆寫**:Info.dat `_customData._envColorLeft` / `_envColorRight`。事件值的紅碼(5/6/7)取左色、藍碼(1/2/3)取右色。
3. **本作預設淡紅藍**(偏淡偏暗):譜面完全沒指定時。
- **跳過環境內建原廠色**(FitBeat / TheWeeknd… 數十種無法複刻)與 `_envColor*Boost`(色 boost 事件),沒覆寫 / 沒 Chroma 直接落到預設淡紅藍。

### 動作
- `i` 同時編「顏色 + 動作」:**off**(0) / **on**(1藍·5紅) / **flash**(2·6) / **fade**(3·7),**四種全收**;未知值當 **on**。
- `f`(浮點)當亮度倍率,缺則 1。白 / 其他色碼 → 中性淡白處理。
- sink 動畫:on 維持、flash 尖峰後衰減回常亮、fade 起亮衰減到 0、off 降到 0。衰減時長取「到下一筆同組事件」或固定衰減常數(實跑微調)。

### 無資料退化
- **緩慢連續正弦呼吸**(淡紅藍),不綁拍、不閃(避免 120–200 BPM 頻閃干擾讀字)。純 sink 端時間正弦,**不合成事件**。
- 適用內建 sample(v2 `_events` 空)與只有新版燈光的譜(overdose)。

### 使用者控制 / 持久化(issue 12)
- **單一「燈光強度」滑桿,0 = 關**,含蓋「可調 + 可關」。
- `Settings` 加 `lightIntensity` 欄位,input 即時套用 + `patchSettings` 持久化,與現有三滑桿(飛行 / offset / 音量)同模式。預設保守中低值。

### 正規化形狀(擬)
`LightShow` = 依 `tSec` 排序的事件陣列:`{ tSec, group, action:'off'|'on'|'flash'|'fade', color:{r,g,b}, brightness }`。sink 維護一個隨 `player.positionSec` 前進的游標,逐筆套到對應 group 的發光體,並補 flash / fade 的衰減 tween。

## Acceptance criteria(第一階段;2026-07-13 實作 + playtest 驗)

- [x] 背景 / 周邊發光體隨譜面燈光事件與音樂同步律動(pale 實跑可見多組發光體隨組明暗)
- [x] 燈光不干擾音符 / 判定辨識:發光體在周邊 / 遠端、避開中央;預設色淡暗;不使用判定四色與音符紅藍的高飽和值(背景維持深色、讀字清晰)
- [x] 時間對齊沿用 `buildBeatToSec`(issue 10),與音符同一時鐘;變速譜燈光落點自動對齊(共用 rawDifficulty)
- [x] 燈光強度可調 / 可關(`lightIntensity` 滑桿,0=關),issue 12 持久化
- [x] 無燈光資料的譜優雅退化為緩慢正弦呼吸(overdose 實跑見 2 顆呼吸體;內建 sample 同機制)
- [x] `compileLightShow` 為純函式,有 vitest 手寫 fixtures(v2/v3 解析、顏色鏈、色燈組計數、四動作、無事件→空時間線);compileChart / judge 既有紀律不破

## 測試 / fixtures

- **純函式**:`compileLightShow` 手寫最小 fixtures(不塞整份譜,留能斷言各分支的幾筆)。
- **sink**:薄渲染層,不寫單元測試 → **playtest-highway** 技能真瀏覽器實跑(pale 看有燈、內建看呼吸退化)。
- fixture 參照(皆在 repo 根):
  - `pale.zip`:v3.3 經典 `basicBeatmapEvents` + Info env 覆寫(淡灰 / 淡青)→ 驗顏色鏈第 2 層。
  - `Junkie Night town Orchestra.zip`:v2 2.6.0 經典 `_events` + 逐事件 Chroma `_color`(11815 筆、8895 帶色)→ 一次驗 **v2 解析路徑 + 顏色鏈第 1 層**。
  - `overdose.zip`:v3.3 只有新版 `lightColorEventBoxGroups`(經典事件空)→ 驗退化呼吸,亦即 issue 24b 目標。
  - 內建 sample:v2 `_events` 空 → 驗退化呼吸。

## 關聯 / Blocked by

- 依賴 issue 06(渲染)、issue 10(BPM 時間線)。**不依賴 issue 20**(自發光燈不需受光面)。
- 與 issue 20(場景)、issue 23(空段落演出)聯動:20 之後可在受光面 / 場景上再疊燈光層次。
- 與音符映射(compile)正交:燈光不影響 TypingChart、判定或計分。

## Out of scope(本階段)

- **新版 v3 燈光 `lightColorEventBoxGroups` → issue 24b**(巢狀群組 / 索引過濾 / 亮度漸層 / 旋轉)。
- 還原 Beat Saber 完整燈光語意(所有群組 / 進階變換 / rotation events / 環境原廠色盤)。
- 燈光編輯(見 issue 22 自製譜面系統)。
