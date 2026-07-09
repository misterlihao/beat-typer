# 04 — zip 拖放載入

> 標籤:`ready-for-agent`(待 tracker 授權後上傳) · 來源:docs/PRD.md

## What to build

讓使用者把 BeatSaver 下載的 zip 直接拖進網頁即可載入。用 JSZip 在瀏覽器內解壓,取出 info.dat、難度檔與音訊,交給 `compileChart`,並在文字預覽呈現結果。I/O 層保持薄:只負責取得原始檔案位元組,不含遊戲邏輯。含清楚的錯誤處理(檔案缺漏、格式不符、音訊解不開)。

## Acceptance criteria

- [ ] 拖放合法 BeatSaver zip 後,顯示該譜面的按鍵序列預覽並可播放音訊
- [ ] zip 內缺檔 / 格式不符 / 音訊無法解碼時,顯示清楚的錯誤訊息而非崩潰
- [ ] loader 只回傳原始檔案位元組,compileChart 仍為純函式且不感知 zip
- [ ] 支援 v2 與 v3 譜面

## Blocked by

- 02 — 完整全格映射 + v3 支援
