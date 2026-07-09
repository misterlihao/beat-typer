# 04 — zip 拖放載入

> 來源:docs/PRD.md

## What to build

讓使用者把 BeatSaver 下載的 zip 直接拖進網頁即可載入。用 JSZip 在瀏覽器內解壓,取出 info.dat、難度檔與音訊,交給 `compileChart`,並在文字預覽呈現結果。I/O 層保持薄:只負責取得原始檔案位元組,不含遊戲邏輯。含清楚的錯誤處理(檔案缺漏、格式不符、音訊解不開)。

## Acceptance criteria

- [x] 拖放合法 BeatSaver zip 後,顯示該譜面的按鍵序列預覽並可播放音訊
- [x] zip 內缺檔 / 格式不符 / 音訊無法解碼時,顯示清楚的錯誤訊息而非崩潰
- [x] loader 只回傳原始檔案位元組,compileChart 仍為純函式且不感知 zip
- [x] 支援 v2 與 v3 譜面

## 實作(2026-07-10 完成)

- `src/loader/zip.ts` `ZipChartSource`(JSZip):basename + 大小寫不敏感查找(見 docs/adr/0007),
  只搬 bytes 不 parse;`ChartSource`/`SongHandle` 介面沿用(ADR 0005),compileChart 零改動。
- `parseInfo` 加 `_songName` → `SongInfo.songName`;orchestrator 標題優先用它、fallback `SongHandle.title`(zip 檔名)。
- `main.ts` 著陸畫面:整窗拖放區 + 點擊選檔 + 「玩內建範例」,三路同一 `bootstrap`;失敗就地紅字、拖放區保留可再拖;window dragover/drop 防呆。
- 錯誤訊息 5 類:非 zip/損毀、缺檔(含檔名)、Info.dat 格式(沿用 parseInfo)、音訊無法解碼。
- 難度維持 `difficulties[0]`(選單留 05)。
- 測試:zip 7 + parseInfo 3(共 +10 → 78 全過);tsc/build 乾淨。
- 實跑驗證(pale.zip,v2 2.1.0):解壓→編譯 305 音符→音訊解碼 156s→高速公路飛行;
  非 zip → 清楚錯誤且可復原再拖;console 無非預期錯誤。

## Blocked by

- 02 — 完整全格映射 + v3 支援
