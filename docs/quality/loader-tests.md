# 譜面載入層(loader)測試案例摘要

- 對應 code:`src/loader/zip.ts`、`src/loader/bsr.ts`、`src/loader/recentBsr.ts`、`src/loader/builtin.ts`
- 對應測試:`src/loader/__tests__/zip.test.ts`、`bsr.test.ts`、`recentBsr.test.ts`
- **真實來源以測試 code 為準,本檔僅快讀投影。** 用途:判斷「測試覆蓋夠不夠」,不是逆推正確性。

## 這是什麼

loader 是薄層,只搬 bytes、不 parse 譜面、不含遊戲邏輯(ADR 0005/0007)。三種 ChartSource:內建範例、zip 譜面包、BSR 線上下載;外加「最近遊玩 BSR」持久化。測試只測純函式與可用記憶體 fixture 驗證的行為;`fetch` / `localStorage` I/O 一律不 mock、不測(以 playtest-highway 實跑驗)。

## 逐條:每組測試在驗什麼行為

### zip.ts(ZipChartSource,用 JSZip 現場產記憶體 zip 當 fixture)
- **讀根層檔案回原始位元組**:`readFile('Info.dat')` 拿回原 bytes。
- **查找大小寫不敏感**:`readFile('Info.dat')` 命中 zip 內 `info.dat`。
- **查找忽略路徑(basename 比對)**:命中巢狀子夾內同 basename 檔(`Pale/Info.dat`、`Pale/song.egg`)。
- **缺檔 → 含檔名的清楚錯誤**:`song.egg` 不存在時丟「譜面包缺少檔案「song.egg」」。
- **壞 / 非 zip 位元組 → 清楚錯誤**:垃圾 bytes 觸發「這個檔案不是有效的 zip 譜面包」而非崩潰。
- **title 備援用 zip 檔名去副檔名**:`Pale.zip` → title `Pale`。
- **撞名(不同子夾同 basename)取先出現者 + warn**:兩個 `Info.dat` 取第一個,並 `console.warn`。

### bsr.ts(純函式 parseBsrCode / pickDownloadUrl;網路 I/O 不測)
- **parseBsrCode 純代號原樣(轉小寫)**:`5277c`、`2A29`→`2a29`。
- **去 `!bsr ` 前綴(不分大小寫、容多空白)**:`!bsr 5277c`、`!BSR 5277C`、多空白皆抽出代號。
- **從 BeatSaver URL 抽代號**:`https://beatsaver.com/maps/5277c`(含 slug 尾段、無協定字首)。
- **去頭尾空白**。
- **無法解析回 null**:空字串、`hello world`、只有前綴無代號、非 hex、非 beatsaver 網域 URL。
- **pickDownloadUrl 取第一個 Published 版本的 downloadURL**:跳過 Testplay,多個 Published 取最前。
- **只有一個 Published 也取到**。
- **無 Published 版本 → 報錯**:只有 Testplay / 空 versions / 無 versions 欄皆丟錯。
- **Published 但缺 downloadURL → 跳過,無其他可用則報錯**。

### recentBsr.ts(純函式 coerceRecentBsr;load/record/toggle I/O 不測)
- **非陣列一律回空清單**:null / undefined / 物件 / 字串。
- **合法項原樣保留**。
- **丟棄壞項**:缺 code / 非字串 code / 空字串 code / null / 非物件 一律剔除。
- **歌名缺 / 非字串 / 空字串 → 退回 code** 當顯示名。
- **pinned 非 true 一律當 false**:舊存檔缺欄、非布林值 皆視為未釘選(同時驗釘選置前)。
- **以 code 去重,保留較前(較新)的一筆**。
- **釘選置前(穩定分割)**:所有釘選排未釘選之前,兩群各維持相對序。
- **截到上限 30 筆,從尾端截**:40 筆全未釘選 → 留最前 30(c0–c29)。
- **截斷不淘汰釘選項目**:釘選在前,超量只砍未釘選尾端,釘選項必留。

## 覆蓋缺口候選(供判斷是否補測)

- **builtin.ts 完全無測試**:`BuiltinChartSource` / `BuiltinSongHandle`(fetch 範例檔、HTTP 非 ok 丟錯)無單元覆蓋(屬純 fetch I/O,可能刻意留給實跑)。
- **BsrChartSource.listSongs 的整條網路流程**(404→「找不到代號」、非 ok→網路錯、JSON 壞→「回應無法解析」、委派 ZipChartSource)未測——已明示交給 playtest;但這些錯誤訊息分支無自動守護。
- **zip 空 zip(合法 zip 但無任何檔)** 時 `listSongs` 回一個 title 對但任何 `readFile` 皆缺檔的 handle,無案例。
- **zip 目錄項(entry.dir)被跳過** 的行為無直接斷言(有 code 守衛,無測試釘住)。
- **parseBsrCode 大小寫混合 hex(如 `5277C`)輸出小寫** 已隱含於 URL 案例,但純代號路徑未單獨驗大寫 hex→小寫(僅驗 `2A29`,可視為已覆蓋)。
- **recentBsr 混合場景**:去重 + 釘選 + 超量同時發生的複合案例(去重後才截斷、去重是否影響「保留較新」與釘選交互)未有單一綜合案例。
- **recordRecentBsr / togglePinnedRecentBsr 的位置語義**(釘選項更新歌名不移位、取消釘選落未釘選頂)在註解描述但無測試(屬 localStorage I/O,未測)。
