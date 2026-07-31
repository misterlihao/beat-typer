# 契約摘要:scores(成績持久化)

對應原始檔:`src/scores/scores.ts`
另參考:CONTEXT.md「成績持久化」全段、docs/adr/0013。
**真實來源以 code + docs/ 為準,本檔僅快讀投影。**

---

## 職責

跨場記住每張譜的最佳成績(issue 18)。純函式(`songKey` / `coefficientFor` / `adjustedAccuracy` / `applyRun` / `coerceScores`)承載全部邏輯、可測;`localStorage` 讀寫(`loadScores` / `recordRun`)為薄 I/O,不 mock、不測。

核心設計:**每張譜只存一筆最佳(不分鍵群)**;跨鍵群靠「調整後準確率」共爭單一最佳。

## 資料形狀

```ts
interface ScoreRecord {
  readonly bestRawAccuracy: number; // 0..1,達成最佳「調整後準確率」那場的原始準確率
  readonly bestKeyGroup: KeyGroup;  // 上者所在鍵群(供顯示脈絡 + 反推調整值)
  readonly bestMaxCombo: number;    // 只在全鍵解鎖計入
  readonly everFullCombo: boolean;  // 只在全鍵解鎖計入
}
interface RunResult { rawAccuracy; keyGroup; maxCombo; fullCombo; } // 一場完賽(取自 judge summary)
interface ScoreStore { version: number; records: Record<songKey, ScoreRecord>; }
```

`STORAGE_KEY = 'beat-typer:scores'`、`SCORES_VERSION = 2`(v2 = 鍵群改「分排」那次:鍵群清單與全鍵鍵池 15→20 皆變,舊紀錄不可比 → 整庫作廢)。

## songKey(歌曲身分)

- 身分 = **選定難度檔原始文字**的雜湊,不是 Info.dat / BSR code / songName。
- 兩個獨立 32-bit 雜湊(djb2 xor 變體 + sdbm)各轉 base36 後串接,降低撞鍵。
- 可決定性:同文字永得同鍵。天生 per-難度、跨來源位元一致、內容真實(remap → 身分變 → 成績重計;純改名 → 同身分 → 保留)。

## 仁慈壓縮曲線

```ts
coefficientFor(kg)  = 0.5 + 0.5 × (keyGroupPoolSize(kg) / keyGroupPoolSize('all'))
adjustedAccuracy(raw, kg) = raw × coefficientFor(kg)
```

- 全鍵 `all` = ×1.0(20 鍵/手);四個單排鍵群皆 5 鍵/手 → 同為 **0.625**(係數只看鍵池大小,不看排的難易——見 ADR 0011 被否決項)。底線 0.5(非鍵數線性,不羞辱針對性練習)。
- 係數由「每手鍵池大小」即時導出(委派 `keyAssignment.keyGroupPoolSize`),鍵群增減自動重算,不寫死表。
- **`adjustedAccuracy` 是跨鍵群唯一可比、用於排名與判定「刷新」的分數。**

## applyRun(刷新規則——最需精確理解的一段)

```ts
applyRun(prev: ScoreRecord | undefined, run: RunResult): { record; improved }
```

純函式,`prev` 可為 `undefined`(首玩)。逐條 gating:

1. **準確率(跨鍵群共爭一個最佳)**
   - `prevAdj = prev ? adjustedAccuracy(prev.bestRawAccuracy, prev.bestKeyGroup) : -1`
   - `runAdj = adjustedAccuracy(run.rawAccuracy, run.keyGroup)`
   - `accImproved = runAdj > prevAdj`(嚴格大於;相等不刷新)
   - 刷新時 `bestRawAccuracy`/`bestKeyGroup` **成對**換成本場的原始值 + 鍵群;否則沿用 prev(首玩沿用本場)。
   - 小鍵群的高原始準確率經折算後仍可能輸給全鍵舊績——這是刻意的。

2. **最大 combo(只在全鍵解鎖)**
   - `isAll = run.keyGroup === 'all'`
   - `comboImproved = isAll && run.maxCombo > prevCombo`
   - `bestMaxCombo = isAll ? max(prevCombo, run.maxCombo) : prevCombo`
   - **非全鍵場一律不動 combo**(維持 prev,首玩為 0)。

3. **全連(只在全鍵解鎖,單向鎖存)**
   - `fcImproved = isAll && run.fullCombo && !prevFC`
   - `everFullCombo = prevFC || (isAll && run.fullCombo)`(一旦 true 永不回退;非全鍵的 fullCombo 不計)。

4. **`improved` 回報** = `accImproved || comboImproved || fcImproved`(供結算顯示「🏆新紀錄」)。

要點:三項指標各自獨立單調更新,不綁成整場快照(避免弄丟獨立的全連成就)。combo/FC 的 gating 條件是 `isAll`,準確率則所有鍵群折算後共爭。

## coerceScores / coerceRecord(防禦性正規化)

把任意來源(壞 JSON、被竄改、舊版)強制成合法 `ScoreStore`,純函式:

- 整包層:非物件 / `version !== 2` / `records` 非物件 → **空庫**(只認當前版,舊版直接丟棄重來,無 migration)。
- 逐筆層 `coerceRecord`:任一欄位型別/值不合 → 回 `null`(**丟棄該筆**,不污染整庫)。
  - `bestRawAccuracy`:須有限 number → `clamp01`(夾 0..1)。
  - `bestKeyGroup`:須在 `KEY_GROUPS` 內。
  - `bestMaxCombo`:須有限 number → `max(0, floor(·))`(非負整數)。
  - `everFullCombo`:須 boolean。
- 好紀錄保留、壞紀錄靜默丟棄。

## 薄 I/O(不 mock、不測)

- `loadScores()`:讀 localStorage → `JSON.parse` → `coerceScores`。不可用 / 空 / 壞 JSON 一律靜默回退空庫。
- `recordRun(diffText, run)`:`load → applyRun(store.records[songKey(diffText)], run) → 寫回`;回傳 `{ record, improved }`。寫入失敗(配額/停用)靜默略過,不影響遊玩。

## 不變式

- 每個歌曲身分至多一筆 `ScoreRecord`。
- 準確率跨鍵群靠 `adjustedAccuracy` 單調刷新;combo/FC 僅全鍵貢獻且單調不退。
- 純函式部分無 I/O;I/O 部分不含判斷邏輯(邏輯全在 `applyRun`)。
- 任何損壞輸入都收斂成合法 store(最壞為空庫),不丟例外給呼叫端。
