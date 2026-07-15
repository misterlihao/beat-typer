# backup 契約摘要(IS 級)

對應原始檔:`src/backup/backup.ts`
(相關:`src/scores/scores.ts` 的 `coerceScores` / `adjustedAccuracy`、`src/settings/settings.ts` 的 `coerceSettings` / `patchSettings`、`src/loader/recentBsr.ts` 的 `coerceRecentBsr`)

> **真實來源以 code 為準,本檔僅快讀契約投影。**
> 用途:審查者只讀本檔即可逐條確認「保護玩家累積成績」的安全不變式是否成立,不必細讀原 code,也不靠「信一個可能沒覆蓋到的測試綠燈」。

backup 模組把三個 localStorage store(設定 / 成績 / 最近 BSR 清單)倒成一份可攜 `.json` 備份,並在別的裝置匯回。因匯入可能覆蓋玩家歷來累積成績,本模組列為 IS 級。

---

## 安全不變式(審查重點,逐條確認)

以下每條若破,玩家的累積成績有被錯誤覆蓋或損毀的風險。

1. **⚠ parse 失敗 → 絕不寫入任何 store。**
   `importBackup` 內:`JSON.parse` throw → 直接 `return { ok:false }`;`parseBackup` 回 `ok:false`(非物件 / 非本 app / 版本不認)→ 直接 `return`。兩個 return 都在**任何 `localStorage.setItem` / `patchSettings` 之前**。
   **此不變式目前僅靠 code 中的註解(第 149 行)與控制流順序保證、無測試覆蓋。** 審查時須逐行確認:`importBackup` 中通往寫入的路徑,一定先經過「parse 成功」這道閘,任何 early-return 都在寫入之前,且將來新增分支不得在 parse 前就寫。

2. **合法信封但個別資料壞 → salvage,不整份拒絕、也不清空既有資料。**
   `parseBackup` 對合法信封逐 store 過 `coerce*`:壞的紀錄丟、好的留(見「信封 / 版本」)。避免「一筆壞紀錄害整份匯入失敗」而讓玩家以為要放棄整包。

3. **合併模式(merge)只增不減成績。**
   `mergeScores` 對現值 `records` 做展開拷貝後逐 incoming 併入:單邊有的收下、兩邊有的取較佳。**current(本機)既有的每一筆都不會在 merge 下消失或被較差值蓋掉。**

4. **合併模式絕不改本機設定。**
   `mergeBackup` 的 merge 分支 `settings: current.settings` 原封帶回;`importBackup` 僅在 `mode === 'replace'` 時呼叫 `patchSettings`。合併匯入不動玩家的手感偏好(flightTime / offset / 音量 / 燈光 / 鍵群)。

5. **寫入是「兩筆盡力」而非交易式;寫入失敗回報失敗。**
   `importBackup` 對 scores / recent 兩個 key 連續 `setItem`,任一 throw(配額 / 停用)→ catch → 回 `ok:false`。
   **審查注意(非交易性):** 若第一筆 `setItem` 成功、第二筆 throw,第一筆已落地無法回滾。目前資料形狀下兩筆各自為完整 blob、彼此無引用完整性依賴,故不致產生半截損毀紀錄;但這是「盡力寫入」語意,不是原子交易。

6. **覆蓋模式(replace)是玩家明示的整包取代。**
   replace 下三 store 全取 incoming(含設定)。這是設計上的「有意覆蓋」,非不變式漏洞——UI 須讓玩家清楚選的是 replace 而非 merge。

---

## 公開介面(輸入 / 輸出契約)

純函式(主測試接縫,不含 I/O):

- **`buildBackup(data: BackupData, exportedAt: string): Backup`**
  由三 store 現值 + 外部注入的時戳組信封。純函式不碰時鐘(`exportedAt` 由呼叫端給)。輸出見「信封 / 版本」。

- **`parseBackup(raw: unknown): ParseResult`**
  認信封 + 逐 store coerce。
  輸出 `{ ok:true, data:BackupData }`(合法)或 `{ ok:false, reason:string }`(拒絕,reason 供就地報錯)。詳見「信封 / 版本」與「安全不變式 2」。

- **`mergeBackup(current: BackupData, incoming: BackupData, mode: ImportMode): BackupData`**
  依模式併兩份資料,回新的 `BackupData`。純函式,不寫 store。語意見「合併語意」。

薄 I/O(不 mock、不測):

- **`exportBackup(): void`**
  讀三 store 現值 → `buildBackup`(時戳 = `now.toISOString()`)→ 觸發 `.json` 下載,檔名 `beat-typer-backup-YYYY-MM-DD.json`。無回傳。

- **`importBackup(text: string, mode: ImportMode): ImportResult`**
  `JSON.parse(text)` → `parseBackup` → `mergeBackup(loadAll(), parsed.data, mode)` → 寫回三 store。
  輸出 `{ ok:true, scoreCount, recentCount }`(併入後計數供回饋)或 `{ ok:false, reason }`。
  設定寫回走 `patchSettings`(僅 replace);成績 / 最近直接 `setItem` 整包 blob。寫入 / parse 失敗契約見「安全不變式 1、5」。

型別:
- `BackupData = { settings: Settings; scores: ScoreStore; recentBsr: RecentBsr[] }`
- `ImportMode = 'merge' | 'replace'`

---

## 合併語意(mergeBackup)

`current` = 本機現值(B),`incoming` = 匯入檔(A)。

| store | replace(覆蓋) | merge(合併) |
|---|---|---|
| settings | 取 incoming(含所有偏好) | **保留 current,完全不碰 A 的偏好** |
| scores | 取 incoming | 逐歌曲身分聯集取較佳(見下) |
| recentBsr | 取 incoming | 聯集去重(見下) |

### scores 逐譜取較佳(`betterRecord`)
兩邊都有同一歌曲身分(key)時:
- **準確率:比較「調整後準確率」**(`adjustedAccuracy(rawAccuracy, keyGroup)`,原始準確率 × 鍵群係數,是跨鍵群唯一可比的分數)。取調整後較高者,並成對搬移其 `bestRawAccuracy` + `bestKeyGroup`(不可只搬 raw,否則鍵群對不上)。
- **跨鍵群可比**:全鍵 80%(調整 0.80)可勝過家排 100%(調整約 0.667)——反映「只練一部分鍵盤拿一部分學分」。
- **平手取邊**:`>` 比較,相等時保留 `x`(即 `betterRecord(prev, rec)` 中的 `prev` = current 本機)。
- **bestMaxCombo 取 `Math.max`;everFullCombo 取 OR。**

單邊有的:直接收下。

### recentBsr 聯集去重(`mergeRecent`)
- **以 `code`(BSR 代號)去重**;current 先插入 Map,故 current 項排前面。
- **釘選:任一邊 pinned 即保留 pinned**(`prev.pinned || r.pinned`)。
- **歌名:衝突時留 current 的**(current 先進 Map,incoming 只覆寫 pinned 欄位、不換 songName)。
- 結果交 `coerceRecentBsr` 做穩定分割(釘選置頂)+ 30 筆上限。

---

## 信封 / 版本

### buildBackup 信封格式
```
{ app: 'beat-typer', kind: 'backup', version: 1, exportedAt: <ISO 字串>, data: BackupData }
```
`app` / `kind` / `version` 為固定常數,供匯入端認出「這是不是本 app 的備份」;`data` 存已 coerce 的物件(人可讀)。

### parseBackup 認檔(整份拒絕條件,`ok:false`)
依序檢查,任一不過即拒絕、不進入寫入路徑:
1. `raw` 非物件 / 為 `null` → `不是有效的備份檔`
2. `app !== 'beat-typer'` → `這不是 Beat Typer 的備份檔`(擋外來 / 別 app 檔)
3. `version !== 1` → `不支援的備份版本(…)`

### parseBackup salvage 容錯(信封合法後)
- `data` 缺 / 非物件 → 視為 `{}`,三 store 各自由 `coerce*` 補預設(settings 回預設值、scores 回 `{version:1, records:{}}`、recentBsr 回 `[]`)。
- 各 store 完全複用其既有 `coerce*`(單一防呆真相來源,不另寫驗證):壞的欄位 / 紀錄丟棄、好的保留。例:某筆成績 `bestRawAccuracy` 非數 → 該筆被 `coerceScores` 濾掉,其餘留存。
- round-trip:`buildBackup` 後 `JSON` 序列化再 `parseBackup` 得回同資料。
