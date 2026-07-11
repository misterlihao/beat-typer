# 09 — 結算畫面 + 評級 + 重玩

> 來源:docs/PRD.md

## What to build

歌曲一律玩到底(無血條、不會 game over)。結束後顯示結算畫面:準確率%、最大 combo、Perfect/Good/Miss 各自數量、總評級(如 S/A/B)。提供「重玩同一張同難度」按鈕。評級由 `judge` 的 `summary` 計算。

## Acceptance criteria

- [ ] 打太爛也不會中斷,一定播到整首結束(已由 issue 13 `player.onEnded` 滿足)
- [ ] 結算顯示評級 + 準確率%(雙主角)、最大 combo、Perfect/Good/Miss 計數、全連徽章(僅 FC 時)（多餘按鍵計數刻意不顯示——對玩家壓力太大）
- [ ] 評級門檻明確且由 `summary` 計算(已有測試;判定權重見 docs/adr/0012)
- [ ] 「重新開始」可用相同譜面與難度立即再來一次(已由 issue 13 `beginFromZero` 滿足)
- [ ] 結束覆蓋層可「回選歌」回到著陸頁(先 cleanup 停音訊/釋放 GPU 再切頁)
- [ ] 遊玩中 HUD 即時顯示評級(不顯得分),前 8 顆已判定音符前不顯,右上與 combo 同區

## 設計定案(grilling 收斂,2026-07-12)

大半已被 issue 07(`summary` 全欄位含 grade,已測)+ issue 13(播到底 / ended 狀態 / 重新開始=重玩)蓋掉;09 的真正工作是把數據**填進結束覆蓋層**並補一個返回出口。

1. **就地強化,不做獨立畫面**:沿用 issue 13 的結束覆蓋層(與暫停共用 DOM),結束時在標題下插「結算面板」;暫停時不顯示該面板。不另搭全螢幕結算頁(會與 13 的 ended 狀態機重疊)。儀式感靠「評級大字進場放大動畫」補。
2. **版面(由上而下)**:`完成!` → 評級大字(依級上色 + pop 動畫)→ 準確率%(次主角大字)→ 全連徽章(僅 `fullCombo`)→ `Perfect n · Good n · Miss n`(綠/青/紅)→ `最大 combo n` → 多餘 n(灰小字)。
3. **導覽動作**:結束面板 = 「重新開始」(現成 `beginFromZero`)+「回選歌」。「回選歌」→ 著陸頁 `showLanding`(目前選歌入口即著陸頁);`startHighway` 收 `onExit` callback,`main.ts` 接;點擊先跑 highway cleanup 再切頁。換難度暫走「回選歌→重載」,不在結束面板另設。
4. **評級門檻沿用**(S≥.95/A≥.85/B≥.7/C≥.5/D),不改數字。判定權重 Perfect 1 / Good 0.5 / Miss 0 的取捨寫成 docs/adr/0012(門檻數字為旋鈕、不入 ADR)。
5. **薄層紀律**:結算只讀 `judger.summary()`,不重算任何數字(評級/準確率/FC 全在 judge 接縫)。新增詞彙:CONTEXT 的「結算」「全連」。
6. **即時評級 HUD**(grill 追加):遊玩中即時顯示「若現在結束的評級」= `summary().grade`(對已判定音符算)。
   - **前 8 顆不顯**:已判定音符 < 8 前完全不顯(或中性「—」),消掉早段 S↔D 抖動;不顯得分(%)。
   - **位置**:右上、與 combo 同區(即時狀態一處掃到)。**安靜小字母**,依級上色,**不做 pop/閃動**(儀式感留給結算大字);評級色為單一真相,結算 hero 與 HUD 共用。
   - **更新**:事件驅動,非每幀——判定集合一變就重算(press 命中/敲錯、release、loop 的自動 Miss(expiry 回傳 missed)、長按鎖定/破)。避免每幀 `summary()` 的 O(N)。

## 延後(grill 決定,不在本 issue)

有了 `summary` 後浮現、但**超出結算薄呈現**、需各自 grill 的新範圍:
- **成績持久化 + 賽前畫面**(合一 issue):儲存每(歌+難度+鍵群?)最佳成績,賽前顯示當目標。**先決難題:歌曲身分**——同曲跨 zip/bsr/builtin 目前無穩定 ID(builtin 固定 / zip 檔名 / bsr 代號),需先定身分鍵才能存。開始畫面依賴此。
- 「即時評級 HUD」本已併入本 issue(見上 6),不在延後之列。

## Blocked by

- 07 — 判定 + 計分 + combo(judge 接縫)
- 13 — 開始/暫停/重玩狀態機(已提供 ended 覆蓋層 + beginFromZero)
