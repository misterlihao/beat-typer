# 05 — CustomLevels 資料夾讀取(+ 選歌畫面)

> 來源:docs/PRD.md
> **拆分(2026-07-11)**:原綁的「難度選單」已獨立為 [issue 17](17-difficulty-select-menu.md) 並完成(惠及全來源)。
> 本 issue 縮為「CustomLevels 資料夾來源 + 多首選歌畫面」,Chromium-only、需手動實跑驗證,延後。
> 資料夾多首載入後,每首仍走 issue 17 的難度選擇畫面。

## What to build

讓已安裝 Beat Saber 的玩家用 File System Access API 選一次 `CustomLevels` 資料夾,遊戲列出裡面所有譜面;授權 handle 持久化於 IndexedDB,下次打開自動記得。任一載入路徑(內建/zip/資料夾)在載入譜面後都能列出可用難度(Easy～ExpertPlus)供玩家選擇,選定後 → `compileChart` → 預覽。僅 Chromium。

## Acceptance criteria

- [ ] 選取 CustomLevels 資料夾後,列出其中所有譜面
- [ ] 授權被持久化,重新整理後不需重選資料夾
- [ ] 選定一張譜面後顯示其可用難度清單
- [ ] 玩家可挑難度,選定後顯示該難度的按鍵序列預覽
- [ ] 非 Chromium 瀏覽器優雅降級(引導改用 zip 拖放)

## 延伸:同機制回收到「最近清單」的本地 zip 重開(2026-07-12 grill 決)

本 issue 的「FS Access handle 持久化於 IndexedDB」機制,也是 issue 19「最近」清單要支援**本地 zip 按一下重開**的底層:
- 瀏覽器**無法用路徑重讀磁碟**,而現行拖放 / `<input type=file>` 只給 `File`(重整即失、不可持久化)。要「重開」就得存**可序列化的 handle**——只有 `showOpenFilePicker()`(單檔)/ `showDirectoryPicker()`(資料夾,本 issue)給得出,且**只有 IndexedDB 能存這種 handle**(路標,非位元組)。
- 因此本地 zip 重開走**與本 issue 同一套** handle+IDB 儲存(共用同一張 handle 表),同樣 Chromium-only、同樣重開需 `queryPermission`/`requestPermission` 重新授權。刻意**不**採「複製位元組進 IDB blob」的替代路線(那是另一套機制、有容量上限、與本 issue 不一致)。
- 待 grill 細節:handle 去重身分、授權被拒 / handle 失效(檔案被移動刪除)的降級、非 Chromium 時「最近」是否隱藏本地 zip 列。

### 建議建置順序(2026-07-12 決)

**共用地基 → 本地 zip 重開 → 本 issue(資料夾)**。本地 zip 是最小試金石(單檔 handle、無資料夾列舉、無多首選歌畫面、接的是已上線的「最近」清單),用最小表面積先把 FS Access + IDB + 重新授權 + handle 失效降級這套風險跑通;之後本 issue 站在已驗證的地基上,只剩資料夾列舉 + 選歌畫面。共用地基 = IDB handle 儲存層 + 授權 helper(`queryPermission`/`requestPermission`)+ 非 Chromium 降級判斷,誰先做誰打,另一個複用。

### 前置決定已拍板(2026-07-12):做下去就移除拖放,統一走 picker

不採「拖放(`File`,不可持久化)+ picker 並存」——UX 太複雜。一旦動工實作 handle 路線,**移除現行拖放 / `<input type=file>` 載入**(`main.ts` 的 `bt-file` input 與拖放區,約 375/397 行),本地 zip **一律走 `showOpenFilePicker`**。後果(接受):本地 zip 因此變 **Chromium-only**;**非 Chromium 只剩 BSR(網路)+ 內建範例**,載入畫面需對非 Chromium 明確引導改用 BSR。

## Blocked by

- 04 — zip 拖放載入
