# PRD — Beat Typer（打字練習音樂遊戲）

> 來源：由 grilling 設計訪談收斂而成的共識。

## Problem Statement

我平常想同時練「打字」和「打節奏遊戲」，但兩者是分開的：純打字練習軟體枯燥、沒有音樂節奏的驅動力；節奏遊戲（如 Beat Saber）好玩卻練不到鍵盤指法。我手上（或網路上）已經有大量 Beat Saber 譜面，希望能把這些現成、對到音樂的譜面內容，直接變成有音樂、有節奏、有爽感的打字練習，而不是自己另外找教材或手動編字表。

## Solution

一個純網頁的 3D 節奏打字遊戲。它讀取 Beat Saber 譜面（拖放 zip、或直接讀本機已安裝的 `CustomLevels` 資料夾），把每個音符依「顏色→左右手、欄→手指、列→鍵盤上中下排」唯一對應到鍵盤上的一個字母，攤平成一條「一次一鍵」的按鍵時間軸。玩家在 3D 高速公路上看著帶字母的音符朝自己飛來，在音符抵達判定平面的瞬間敲對字母。玩完整首歌後看到準確率、最大 combo 與評級。字母永遠面向鏡頭保持可讀，飛行時間固定可調以確保反應時間穩定——既保留 Beat Saber 的節奏與空間手感，又是一套真正在練觸控打字指法的練習。

## User Stories

### 載入譜面（載入層，優先做齊）
1. As a 玩家, I want 把一個 BeatSaver 下載的 zip 直接拖進網頁, so that 不用解壓或整理檔案就能開始玩。
2. As a 玩家, I want 遊戲第一次打開就有一首內建範例譜面可玩, so that 我不必先準備任何檔案就能體驗。
3. As a 已安裝 Beat Saber 的玩家, I want 用瀏覽器選一次我的 `CustomLevels` 資料夾, so that 遊戲能直接列出我現有的所有自訂譜面。
4. As a 已授權資料夾的玩家, I want 遊戲記住我的資料夾授權, so that 下次打開不必重選。
5. As a 玩家, I want 遊戲同時支援 v2 與 v3 格式的譜面, so that 我下載到的新舊譜面都能讀。
6. As a 玩家, I want 在載入一張譜面後看到它包含的難度清單（Easy～ExpertPlus）, so that 我能挑一個適合我的難度。
7. As a 玩家, I want 自己選要玩哪一個難度, so that 我能依當下狀態調整挑戰性。
8. As a 玩家, I want 在載入失敗（檔案缺漏、格式不符、音訊解不開）時看到清楚的錯誤訊息, so that 我知道是哪張譜面有問題而不是遊戲壞了。
9. As a 開發者, I want 一個文字/表格預覽，能把攤平後的「按鍵序列 + 時間點」印出來並可播放音訊對拍, so that 我不必等 3D 畫面完成就能驗證映射與音同步是否正確。

### 音符 → 字母映射
10. As a 打字練習者, I want 每個音符依它的顏色、欄、列唯一對應到一個固定字母, so that 同一個位置每次都是同一個鍵，我能建立肌肉記憶。
11. As a 打字練習者, I want 顏色（紅/藍）決定左手或右手, so that 我練到雙手分工。
12. As a 打字練習者, I want 欄位對應手指、列對應鍵盤上中下排, so that 映射結果就是標準觸控打字的指法分區。
13. As a 打字練習者, I want 映射能覆蓋約 30 個字母/符號鍵（含上中下三排）, so that 練習不只侷限在家鍵。
14. As a 玩家, I want 同一拍的多顆音符被展開成極短間隔的連打（burst）, so that 譜面密度被保留、我能一次一鍵依序敲完。
15. As a 玩家, I want 同拍額外疊上來的音符改對應到閒置的內側食指鍵（左 T/G/B、右 Y/H/N）, so that 連打有獨立手感、不會和主鍵撞在一起。
16. As a 玩家, I want 弧線（arc）被轉成「長按」音符, so that 我需要按住鍵直到弧線結束，增加變化。
17. As a 玩家, I want 炸彈、牆、鏈條在 v1 被忽略, so that 遊戲聚焦在最單純好懂的打字玩法。

### 遊玩（3D）
18. As a 玩家, I want 看到 3D 高速公路上音符從遠方朝我飛來, so that 我體驗到類似 Beat Saber 的沉浸感。
19. As a 玩家, I want 音符上的字母永遠正面朝向鏡頭, so that 不管透視角度我都讀得清要敲哪個鍵。
20. As a 玩家, I want 左手的道在畫面左側、右手的道在右側, so that 視覺位置呼應我的左右手指法。
21. As a 玩家, I want 音符的飛行時間固定且可調（預設約 1.5–2 秒）, so that 不同歌的反應時間一致、我能依能力調整。
22. As a 玩家, I want 音符落點的節奏仍嚴格照譜面時間, so that 我打的節奏和音樂對得上。
23. As a 玩家, I want 遊戲播放譜面的原曲並和音符同步, so that 我跟著音樂打。
24. As a 玩家, I want 一個手動校準 offset 設定, so that 我能補償我的音訊/顯示延遲讓判定變準。

### 判定與計分
25. As a 玩家, I want 在音符抵達判定平面的時間窗內敲對字母得到 Perfect 或 Good（依接近程度）, so that 我的準度被獎勵。
26. As a 玩家, I want 太早、太晚或錯過都算 Miss, so that 判定明確。
27. As a 玩家, I want 當目標音符在判定窗內時我敲錯鍵就算該音符 Miss 並斷 combo, so that 打錯字有回饋、我會想打準。
28. As a 玩家, I want 附近沒有音符時的多餘按鍵只計入準確率統計、不斷 combo, so that 我不會因為手滑而被過度懲罰。
29. As a 玩家, I want 長按音符要在頭部按下、持續按住、尾部附近放開才算命中, so that 弧線玩法有正確判定。
30. As a 玩家, I want 看到即時的 combo 數, so that 我感受到連續打對的爽感。
31. As a 玩家, I want 這首歌不會因為打太爛而 game over, so that 我能一路練到底。
32. As a 玩家, I want 玩完看到結算畫面：準確率%、最大 combo、Perfect/Good/Miss 各自數量、總評級（如 S/A/B）, so that 我能衡量進步。
33. As a 玩家, I want 在結算畫面能重玩同一張同難度, so that 我能反覆練。

## Implementation Decisions

**技術棧**
- 純網頁：Vite + TypeScript。
- 3D 渲染：Three.js（一開始就 3D）。
- zip 解壓：JSZip。
- 本機資料夾：File System Access API（`showDirectoryPicker`），授權 handle 持久化於 IndexedDB。僅 Chromium。

**模組與接縫（本 PRD 的兩個測試接縫）**
- `compileChart(rawMapFiles, difficultyName, config) → TypingChart`（主接縫，純函式、可決定性）。職責：
  - 偵測譜面版本（v2 / v3）並正規化。
  - 讀 info.dat 取得 BPM、`_songTimeOffset`、音訊檔名、難度清單。
  - beat → 秒的時間換算。
  - 全格映射（下表）。
  - 右手欄鏡射（Beat Saber 最左欄對右手食指、最右欄對右手小指）。
  - 同拍音符 → 依時間排序後以極短固定間隔展開為 burst；同拍的「額外」音符改映射到同側食指內側鍵，依列取上/中/下。
  - 弧線（arc）→ `kind: 'hold'`，帶 `holdEndSec`。
  - 濾除炸彈、牆、鏈條。
  - 輸出：有序的 `TypingChart`，元素形如 `{ tSec: number, key: string, kind: 'press' | 'hold', holdEndSec?: number }`（外加渲染所需的道/手/列等中繼欄位）。
- `judge(chart, inputEvents, config) → { judgments, summary }`（次接縫，純函式）。職責：以帶時戳的按鍵事件對 chart 做節奏判定，產出每音符 Perfect/Good/Miss 與 `summary`（準確率、最大 combo、各判定計數、評級）。

**映射表（全格，唯一對應）**：顏色→左右手、欄→手指、列→鍵盤上中下排。

| 手指（欄） | 上排(layer2) | 家排(layer1) | 下排(layer0) |
|---|---|---|---|
| 左小指(col0) | Q | A | Z |
| 左無名(col1) | W | S | X |
| 左中指(col2) | E | D | C |
| 左食指(col3) | R | F | V |
| 右食指(col0) | U | J | M |
| 右中指(col1) | I | K | , |
| 右無名(col2) | O | L | . |
| 右小指(col3) | P | ; | / |
| 左食指內側（burst） | T | G | B |
| 右食指內側（burst） | Y | H | N |

**判定契約**
- 判定分級由「按下時間與音符 `tSec` 的差」落在哪個時間窗決定：窗內近→Perfect、窗內遠→Good、出窗→Miss。窗寬與 offset 由 `config` 提供。
- 目標音符在判定窗內時，錯鍵按下 → 該音符判 Miss + 斷 combo。
- 無音符在窗內時的按鍵 → 記為「多餘按鍵」，計入準確率統計但不斷 combo。
- `hold`：頭部在窗內按下起算，需持續按住至 `holdEndSec` 附近放開；提早放或未按住→依 hold 判定規則降級/Miss。

**時鐘與音訊**
- OGG（song.egg）以 Web Audio `decodeAudioData` 解碼。
- `AudioContext.currentTime` 為主時鐘；音符時間軸與 3D 動畫都對齊此時鐘。
- 提供手動校準 offset（進入 `config`，同時影響判定與視覺）。

**渲染與 I/O 為薄層**
- Three.js 場景消費 `TypingChart` 產出的中繼資料驅動音符生成/移動；字母以 billboard 面向鏡頭。
- 飛行時間為我方固定可調常數，不沿用譜面 NJS；節奏落點仍照 `tSec`。
- JSZip 與 File System Access 只負責取得原始檔案位元組，交給 `compileChart`，本身不含遊戲邏輯。

**建置順序**
1. 載入層做齊：專案骨架 → v2/v3 解析 → `compileChart` 全格映射 → zip 拖放 → CustomLevels 資料夾讀取 → 文字/表格驗證預覽（含音訊對拍）。
2. 3D 遊戲：高速公路/飛行/billboard → `judge` 判定 → 結算畫面 → 難度選單串接。

## Testing Decisions

**好測試的原則**：只測外部行為，不測實作細節。兩個接縫都是純函式，用固定輸入斷言固定輸出，不需要 mock 檔案系統、音訊或 Three.js。

**受測模組**
- `compileChart`（主要）：以手寫的 Beat Saber v2 / v3 JSON fixtures 為輸入，斷言輸出的 `TypingChart`。涵蓋案例：
  - v2 與 v3 各自的基本音符 → 正確字母（覆蓋映射表每一格）。
  - 顏色→左右手、欄→手指、列→上中下排的對應正確；右手欄鏡射正確。
  - beat→秒換算（含非 4/4 或 offset）正確。
  - 同拍多音符 → burst 間隔展開且順序正確；額外音符落到 T/G/B、Y/H/N 且依列正確。
  - 弧線 → `kind:'hold'` 且 `holdEndSec` 正確。
  - 炸彈/牆/鏈條被濾除。
- `judge`（次要）：以「編譯後的 chart + 一串帶時戳的按鍵事件」為輸入，斷言 judgments 與 summary。涵蓋案例：
  - 窗內近/遠 → Perfect/Good；出窗 → Miss。
  - 窗內錯鍵 → 該音符 Miss + combo 歸零。
  - 窗外多餘按鍵 → 計入準確率但不斷 combo。
  - 長按：正確按住命中；提早放開/未按住 → 降級或 Miss。
  - summary 的準確率、最大 combo、各判定計數、評級計算正確。

**Prior art**：目前為全新專案，尚無既有測試可參照；這兩組將是專案第一批測試，建立「純函式 + fixtures」的慣例供後續沿用。

## Out of Scope

- 血條/失敗/game over 機制（日後可作為可開關的挑戰模式）。
- 沿用譜面 NJS 的音符飛行速度。
- 炸彈作為「陷阱鍵」、鏈條展開成連打（v1 忽略；未來可加）。
- BeatSaver API 線上以 ID/連結下載譜面。
- 非 Chromium 瀏覽器的本機資料夾讀取（Firefox/Safari 僅支援 zip 拖放）。
- 排行榜、帳號、雲端存檔、社群分享。
- 譜面編輯或字母映射的使用者自訂。
- 手把/其他輸入裝置；本作僅鍵盤。

## Further Notes

- 本 PRD 由 grilling 設計訪談收斂，所有主要分支已與使用者確認。
- 進度與 issue 追蹤一律用 task-tracker 技能;切片規格存於 `docs/issues/`。
- 可讀性是 3D 化的最大風險，已以「billboard 字母 + 固定可調飛行時間」對沖；載入層的文字驗證預覽讓映射與音同步能在 3D 完成前先被驗證，降低整體風險。
