# 16 — 用 BSR 代號從 BeatSaver 下載譜面

> 來源:使用者需求——除了拖放本機 zip,想直接貼 BeatSaver 的 BSR 代號就載入。
> 設計經 grill-with-docs 收斂(2026-07-11),CORS 與端點已實測。

## 問題

現在只能拖放/選檔本機 zip。玩家常在 BeatSaver 看到想練的圖,得先手動下載 zip 再拖進來。
直接輸入 BSR 代號(或 `!bsr 代號`)即可載入,省掉下載步驟。

## 技術地基(已實測,2026-07-11)

- **API**:`GET https://api.beatsaver.com/maps/id/{bsr}` → JSON,含 `versions[]`,每個有 `state`、`downloadURL`(r2cdn 的 `.zip`)、`coverURL`、`metadata.songName`。
- **CDN**:`downloadURL` 指向 `https://r2cdn.beatsaver.com/{hash}.zip`。
- **CORS**:API(`api.beatsaver.com`)與 CDN(`r2cdn.beatsaver.com`)皆回 `access-control-allow-origin: *`。
  → **純前端可行,GitHub Pages 靜態部署不需任何 proxy**。

## What to build

一個新的 `ChartSource`:`BsrChartSource`(`src/loader/bsr.ts`),把「BSR 代號 → 下載 zip bytes」這段 I/O 做薄,
下游解 zip / 讀 Info.dat / 編譯全部沿用既有路徑(包進 `ZipChartSource` 或共用其解壓邏輯)。

### 定案(grill 收斂)

1. **輸入格式**:接受純代號 `5277c`、`!bsr 5277c`(BeatSaver「複製 !bsr」按鈕產物,不分大小寫),順手也吃完整 URL `https://beatsaver.com/maps/5277c`。
   - 純函式 `parseBsrCode(input): string | null`:trim → 去開頭可選 `!bsr `(不分大小寫)→ 從 URL 抽 `/maps/{key}` 或取剩餘 token → 驗證 `^[0-9a-f]+$`(轉小寫)→ 不合法回 `null`。
2. **版本選擇**:取 `versions[]` 中**第一個 `state === "Published"`** 的 `downloadURL`(= 官網下載鈕給的那版)。全無 Published → 報「查無可下載版本」。
   - 純函式 `pickDownloadUrl(apiJson): string`(挑第一個 Published 的 downloadURL)。
3. **歌名/封面來源**:**zip 的 Info.dat 為唯一真相,與拖放路徑完全一致、零特例**。API 的 `metadata.songName` 只當 `SongHandle.title` 備援(抓 downloadURL 那份 JSON 已在手,免費)。
4. **載入回饋**:純文字「下載中…」(複用著陸畫面 `setBusy`),不顯示百分比進度條(`fetch` 一把抓 `arrayBuffer`)。
5. **著陸畫面版面**:拖放區(主)下方加一行「── 或用 BeatSaver 代號 ──」+ 文字輸入框 + 〔下載〕鈕,再下面才是「玩內建範例」。輸入框按 **Enter** = 按下載。錯誤紅字沿用同一個 `#bt-error`。

### 錯誤處理(沿用著陸畫面紅字、可再試)

BSR 專屬錯誤(新增):
- 代號格式不對(`parseBsrCode` 回 null)→「BSR 代號格式不對(範例:5277c 或 !bsr 5277c)」
- API 404 / 查無此圖 →「找不到這個 BSR 代號的譜面」
- 無 Published 版本 →「這張圖查無可下載版本」
- 網路失敗 / 離線(fetch reject)→「下載失敗,請檢查網路連線後再試」

zip 解開之後的錯誤(缺檔 / 格式 / 音訊解不開)已被既有 `ZipChartSource` + `bootstrap` 路徑接住,不重寫。

## Acceptance criteria

- [ ] 輸入合法 BSR(`5277c` 或 `!bsr 5277c` 或完整 URL)→ 下載並載入該譜面、可播放與遊玩
- [ ] `parseBsrCode` 正確處理:純代號 / `!bsr ` 前綴(含大小寫)/ URL / 亂碼→null
- [ ] `pickDownloadUrl` 取第一個 Published 版本;全無 Published → 明確錯誤
- [ ] 下載/查詢失敗(404 / 網路 / 無版本)→ 著陸畫面清楚紅字,可直接再試
- [ ] 歌名/封面來自 zip Info.dat(與拖放一致);API 名字僅 title 備援
- [ ] loader 只搬 bytes,compileChart / judge 純函式不感知網路
- [ ] `parseBsrCode`、`pickDownloadUrl` 有 vitest fixtures;fetch/`BsrChartSource` 以 playtest-highway 實跑驗

## Blocked by / 關聯

- 依賴既有載入層接縫(`ChartSource` / `SongHandle` / `bootstrap`,ADR 0005)與 `ZipChartSource`(issue 04)、`parseInfo` 封面(polish a6f3c6c)。皆已完成。
- 與 issue 05(CustomLevels 資料夾 + 難度選單)獨立:05 是本機多首、多難度選單;16 是網路單首、沿用 `pickPlayableDifficulty`。

## Out of scope

- 下載快取 / 歷史紀錄(交給瀏覽器 HTTP cache)。
- 難度選單(維持 `pickPlayableDifficulty`,選單留 issue 05)。
- 搜尋 / 瀏覽 BeatSaver(只做「已知代號直接載入」)。
- 真實下載進度條(只做「下載中…」文字)。
- 設定 User-Agent / rate-limit 處理(瀏覽器無法設 UA;個人用量無虞)。
