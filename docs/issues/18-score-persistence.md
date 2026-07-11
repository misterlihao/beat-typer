# 18 — 成績持久化(最佳成績儲存)

> 來源:grilling issue 09 衍生(2026-07-12)——有了 `judge.summary`(準確率/評級/combo/FC),自然浮現「記住最佳成績」的需求。
> **狀態:設計已 grill 收斂(2026-07-12),見下方設計定案 + docs/adr/0013。待實作。**

## 問題 / 動機

每場結算(issue 09)的成績目前**播完即逝**。玩家沒有「上次打幾分 / 要不要刷新」的動機。想把每(歌 + 難度 + ?)的最佳成績存進 localStorage(沿用 issue 12 設定層的持久化路數),供結算與賽前畫面(issue 19)顯示。

## 先決難題:歌曲身分(Song Identity)

**這是本 issue 的核心設計題,得先解才能存。** 同一首歌可從三種來源進來,目前**無穩定 ID**:

- **內建範例**:固定,可用常數 key。
- **zip 拖放**:只有檔名(玩家可改名、重下載),不穩。
- **BSR 下載**:有代號(較穩),但下載後也變成 zip 流程。

要定一個「同曲跨來源盡量同 key、跨難度/鍵群分開」的身分鍵(候選:BSR 代號優先、否則 songName+audioFilename hash、或 Info.dat 內容 hash)。錯的身分鍵會讓成績認錯歌或永遠對不上。

## 設計定案(grill 收斂,2026-07-12;完整推理見 docs/adr/0013)

1. **歌曲身分 = 選定難度檔原始文字的雜湊**(`songKey(diffText)`,djb2/FNV → base36)。天生 per-難度、跨來源位元一致、內容真實(remap 重計、改名保留)。**不**用 Info.dat / BSR code / songName 組合。
2. **每張譜只存一筆最佳,不分鍵群**。跨鍵群靠**調整後準確率 = 原始 × 鍵群係數**比較。
3. **鍵群係數** = `0.5 + 0.5 × (每手鍵數 / 15)`(由鍵池大小導出,非寫死):全鍵 1.0 / 家+上 0.83 / 食中 0.80 / 無名小 0.70 / 家排 0.67。
4. **紀錄** = `{ bestRawAccuracy, bestKeyGroup, bestMaxCombo, everFullCombo }`。更新單調:
   - `adjusted = raw × 係數`;`adjusted > 存 → 換 bestRawAccuracy + bestKeyGroup`。
   - **`bestMaxCombo` 與 `everFullCombo` 只在 `all` 下解鎖**(小鍵群太好拿不計):`all` 時 `max` / `||=`。
5. **模組**:新 `src/scores/scores.ts`。純函式 `songKey` / `adjustedAccuracy` / `updateRecord`(prev 可 undefined)/ `coerceScores`(容錯 + version 遷移);薄 I/O `loadScores` / `saveScores`,單一 blob `beat-typer:scores`。不做淘汰。
6. **寫入接線**:歌自然播畢(`onEnded`)時,`startHighway` 的 `onComplete?(summary)` 回呼交給 main(綁 `songKey(diffText)`+鍵群)寫入,回傳 `BestInfo` 供結算面板顯示。highway 對身分/儲存無感。DEV 覆寫譜面(?occtest/?holdtest)時跳過寫入。
7. **顯示(本 issue 只做最小)**:結算面板加一行「最佳 {調整後}%({鍵群})」;本場刷新 → 「🏆 新紀錄!」。**過去最大 combo 與曾全連皆不顯示**(結算面板已有本場最大 combo 與 ⚡FULL COMBO,毋須再秀歷史值);`bestMaxCombo` / `everFullCombo` 仍儲存供未來(issue 19)使用。豐富的賽前「目標」呈現留給 issue 19。
8. **原始 vs 調整後的職責切分**:**原始**準確率/評級 = 執行回饋(即時 HUD 評級 + 結算 hero),與練哪套鍵無關,**不套係數**(issue 09 現況零改動);**調整後**準確率 = 排名/紀錄分數,只活在最佳成績與🏆刷新判定。結算同時秀兩者(本場原始 hero + 最佳調整後)反而讓玩家看見係數效果。

## Acceptance criteria

- [ ] `songKey(diffText)` 純函式:同輸入同鍵(determinism)、不同難度檔不同鍵;有測試
- [ ] `adjustedAccuracy(raw, keyGroup)` 純函式:all=×1、小鍵群折算依係數表;有測試
- [ ] `updateRecord(prev, run)` 純函式:準確率單調刷新、combo/FC 只全鍵解鎖、prev undefined 首玩;有測試
- [ ] `coerceScores` 壞資料/版本不符靜默回退(不 mock localStorage,純函式部分可測)
- [ ] 歌播畢寫入/更新最佳;結算面板顯示最佳一行 + 刷新標記
- [ ] DEV 覆寫譜面時不寫入成績

## Blocked by

- 07 — judge summary(已完成)
- 09 — 結算畫面(提供成績來源與顯示位)

## 關聯

- issue 19(賽前/開始畫面)依賴本 issue:沒有存下來的成績就沒有「目標」可秀。
- 沿用 issue 12 設定層的 localStorage 容錯路數(coerceSettings 式)。
