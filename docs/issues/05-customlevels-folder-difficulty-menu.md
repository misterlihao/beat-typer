# 05 — CustomLevels 資料夾讀取 + 難度選單

> 來源:docs/PRD.md

## What to build

讓已安裝 Beat Saber 的玩家用 File System Access API 選一次 `CustomLevels` 資料夾,遊戲列出裡面所有譜面;授權 handle 持久化於 IndexedDB,下次打開自動記得。任一載入路徑(內建/zip/資料夾)在載入譜面後都能列出可用難度(Easy～ExpertPlus)供玩家選擇,選定後 → `compileChart` → 預覽。僅 Chromium。

## Acceptance criteria

- [ ] 選取 CustomLevels 資料夾後,列出其中所有譜面
- [ ] 授權被持久化,重新整理後不需重選資料夾
- [ ] 選定一張譜面後顯示其可用難度清單
- [ ] 玩家可挑難度,選定後顯示該難度的按鍵序列預覽
- [ ] 非 Chromium 瀏覽器優雅降級(引導改用 zip 拖放)

## Blocked by

- 04 — zip 拖放載入
