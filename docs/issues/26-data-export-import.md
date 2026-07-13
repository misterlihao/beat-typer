# 26 — 資料匯出 / 匯入(跨裝置搬移)

> 來源:使用者需求 + grilling 收斂(2026-07-13)——「倒出所有 local storage 儲存的資料,用於導入到別的裝置上」。
> **狀態:設計已 grill 收斂(2026-07-13),見下方設計定案。待實作。**

## 問題 / 動機

玩家的所有持久資料都只活在單一裝置的 localStorage,換裝置 / 重灌 / 換瀏覽器就全沒了。三個 store(皆 `beat-typer:` 前綴):

- `beat-typer:settings` — 玩家偏好(飛行時間 / offset / 按鍵音量 / 燈光強度 / 訓練鍵群)。見 issue 12 / 15。
- `beat-typer:scores` — 每張譜(每個歌曲身分)一筆最佳成績,帶 `version: 1`。見 issue 18 / adr 0013。
- `beat-typer:recent-bsr` — 最近 / 釘選的 BSR 清單。見 issue 19 切片。

要能把 A 裝置的資料倒成一份可攜檔案,搬到 B 裝置匯入。

## 設計定案(grill 收斂,2026-07-13)

1. **範圍 = 匯出 + 匯入都做**。少了匯入端,匯出檔無處可去。
2. **傳輸 = 下載 / 上傳 JSON 檔**。匯出下載一個 `.json`,匯入用獨立選檔(不碰著陸頁既有的 `.zip` 拖放區,避免混淆)。與現有單檔搬移直覺一致,資料再大也不怕。
3. **入口 = 著陸畫面底部一小區**(「玩內建範例」下方),低調的「匯出備份 / 匯入」文字鈕。不新開畫面、不做齒輪 overlay(與現有極簡 UI 一致)。
4. **匯出範圍 = 已知三個 store**(非掃前綴)。每個 store 都有專屬合併語義,匯入需逐 store 理解;將來新增 store 需改匯出程式碼(可接受)。
5. **信封格式**:
   ```json
   { "app": "beat-typer", "kind": "backup", "version": 1,
     "exportedAt": "2026-07-13T12:34:56.789Z",
     "data": { "settings": {...}, "scores": {...}, "recentBsr": [...] } }
   ```
   - 各 store 存**解析後物件**(非字串),人可讀。
   - `app` / `version` 供匯入認出「這是不是本 app 的備份檔」→ 拒外來檔;`version` 供未來遷移(目前僅 v1)。
   - 檔名:`beat-typer-backup-YYYY-MM-DD.json`(帶當日日期)。
6. **匯入合併策略 = 合併 / 覆蓋,全域單選**(非逐 store):
   - **覆蓋**:匯入檔的三個 store 完全取代 B 現有的(含設定)。**破壞性 → 執行前原生 `confirm()` 二次確認**(「將取代現有 N 筆成績,確定?」)。
   - **合併**:不洗 B 的資料,只帶進累加型資料:
     - **成績**:逐歌曲身分 record-vs-record 併(見下);
     - **最近清單**:以代號取聯集、任一邊釘選即保留釘選、B 的項目排前面 → 交給既有 `coerceRecentBsr`(穩定分割 + 30 上限)收束;
     - **設定**:**不碰 B 的設定**(飛行時間 / 音量 等是裝置專屬手感,不覆蓋)。
     - 合併非破壞性 → 選檔即直接做,不需確認。
7. **成績 record-vs-record 合併**(兩邊同一張譜都有紀錄時,照 `applyRun` 精神):
   - 準確率:比 `adjustedAccuracy(bestRawAccuracy, bestKeyGroup)`,取高者(raw 與 keyGroup **成對**搬移);
   - `bestMaxCombo`:取 `max`;
   - `everFullCombo`:`||`。
   - 只在一邊有紀錄 → 直接收該筆。
8. **驗證 / 容錯**(延續現有哲學):
   - 非 JSON / 缺 `app: "beat-typer"` / `version` 不認 → 就地紅字報錯拒絕(如著陸頁 `#bt-error`),不寫入任何東西。
   - 信封合法但某 store 壞 / 部分紀錄壞 → 一律過既有 `coerceSettings` / `coerceScores` / `coerceRecentBsr`,壞紀錄丟棄、好的保留(salvage)。
9. **模組 = 新 `src/backup/backup.ts`**(跨三 store 的橫切關注,獨立於各 store 模組):
   - 純函式(**主測試接縫**,手寫 fixtures 斷言):
     - `buildBackup(settings, scores, recentBsr)` → 信封物件;
     - `parseBackup(raw: unknown)` → `{ ok: true, data } | { ok: false, reason }`,認信封 + 逐 store `coerce*`;
     - `mergeBackup(current, incoming, mode)` → 新的 `{ settings, scores, recentBsr }`(覆蓋 = 全取 incoming;合併 = 上述語義)。
   - 薄 I/O(不 mock、不測):
     - 匯出:讀三 store → `buildBackup` → `JSON.stringify` → 觸發 `Blob` 下載;
     - 匯入:讀檔文字 → `parseBackup` → `mergeBackup` → 分別寫回三 store。
   - `exportedAt` 時戳在薄 I/O 層戳(`new Date().toISOString()`),純函式不碰時鐘。
10. **匯入後回饋**:成功顯示「已匯入:成績 N 筆、最近 M 筆」並就地重繪著陸頁(`renderRecent`;著陸頁所有資料皆即時讀取,免整頁重載)。

## Acceptance criteria

- [ ] `buildBackup(settings, scores, recentBsr)` 純函式:產出帶 `app`/`kind`/`version`/`data` 的信封;有測試
- [ ] `parseBackup(raw)` 純函式:拒非本 app / 壞信封;合法信封逐 store 過 `coerce*`、salvage 壞紀錄;有測試(含外來檔、壞 JSON parse 結果、部分壞紀錄)
- [ ] `mergeBackup(current, incoming, 'replace')`:三 store 全取 incoming;有測試
- [ ] `mergeBackup(current, incoming, 'merge')`:設定保留 current;成績逐譜取較佳(adjusted 比、combo max、FC OR);最近清單聯集去重 + 釘選保留;有測試(含兩邊同譜、單邊有、釘選衝突)
- [ ] 著陸頁底部匯出鈕:下載帶當日日期的 `.json`
- [ ] 著陸頁底部匯入:選檔 + 合併/覆蓋單選;覆蓋前 `confirm()`;非本 app 檔就地紅字報錯
- [ ] 匯入成功顯示「已匯入 N/M」並就地重繪最近清單
- [ ] 薄 I/O(下載 / 選檔 / 寫回)不 mock、不測

## Blocked by

- 12 — 設定持久化(`coerceSettings`,已完成)
- 18 — 成績持久化(`coerceScores` / `adjustedAccuracy` / `ScoreStore`,已完成)
- 19 切片 — 最近 BSR(`coerceRecentBsr` / `RecentBsr`,已完成)

## 關聯

- 完全複用三個既有 store 的 `coerce*` 純函式做匯入驗證與 salvage(單一防呆真相來源,不另寫驗證)。
- 沿用 issue 12 起的 localStorage 容錯 / 薄 I/O 路數。
</content>
</invoke>
