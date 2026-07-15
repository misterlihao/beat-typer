# 契約摘要:BPM 時間線(beat→秒)

對應原始檔:`src/compile/bpmTimeline.ts`
另參考:CONTEXT.md「變速 / BPM 時間線」、docs/adr/0009。
**真實來源以 code + docs/ 為準,本檔僅快讀投影。**

---

## 職責

把「格式無關的 BPM 時間線」建成一個純函式 `beat → 秒`。支援曲中變速(分段常數 BPM 積分)。不含 I/O、無 RNG、可決定性。

**明確不做的事**：不讀 v2/v3 譜、不辨欄位名、不加 `songTimeOffset`。時間線的來源讀取與正規化在 `compileChart` 的 v2/v3 分流做;此檔只吃已決定好的 `[{beat, bpm}]`。輸出的秒數**未含** `songTimeOffset`(呼叫端自行相加)。

## 公開介面

```ts
interface BpmSegment { readonly beat: number; readonly bpm: number; }

function buildBeatToSec(
  timeline: readonly BpmSegment[],
  baseBpm: number,
): (beat: number) => number
```

- `timeline`:排序無所謂(內部會排),一段自 `beat` 起以 `bpm` 播放,直到下一段。
- `baseBpm`:Info.dat 的 `_beatsPerMinute`,作為「首段之前」與「無時間線全曲」的基準。
- 回傳:`(beat) => sec` 的閉包,可重複呼叫。

## 行為契約

- **分段常數積分**:區段以其 BPM 等速換算,總時間 = 各已跨區段 `Δbeat × (60/BPM)` 之和,再加上當前區段內 `(beat − 段起點) × (60/段BPM)`。等速平乘無法對齊變速點後的落點,故必須積分。
- **區段語意 = 半開區間 `[bᵢ, bᵢ₊₁)`**:落在某段起點(含)到下一段起點(不含)之間的 beat,用該段 BPM;查詢取「最後一個 `startBeat ≤ beat` 的段」(二分)。beat 超過最後一段起點時,用最後一段 BPM 外推(無上界)。
- **首段建立規則**:若無時間線,或首事件不在 `beat 0`,則以 `baseBpm` 從 `beat 0` 起補一段;`beat 0` 已有事件時不重複補。首段 `startSec = 0`。
- **v2 vs v3(由呼叫端決定,此檔不分辨)**:v3 `bpmEvents` 會被正規化成時間線傳入(多段積分);v2 一律等速,傳入空時間線 + Info BPM,退化成單一常數換算。v2 `_customData._BPMChanges` **不參與換算**(本體不讀,積分會把落點算歪——見 ADR 0009 修正)。

## 邊界 / 健壯性規則(輸入清洗)

- 濾除:`bpm ≤ 0`、`beat < 0`、非有限數(`beat`/`bpm` 任一非 finite)。
- 依 `beat` 升序排序。
- 同 `beat` 去重:保留**最後一筆**(後寫覆蓋)。
- 清洗後為空 → 退化為 `baseBpm` 常數換算(與舊等速行為一致,不回歸)。
- `baseBpm ≤ 0` 的防禦:首段 fallback 為 `120`。

## 不變式

- `beat 0 → 0 秒`(未含 offset)。
- 函式單調遞增(所有 BPM > 0)。
- 純函式:同輸入永得同輸出,無副作用。
- 單段時間線(或空)等同單一常數 BPM,與變更前行為完全一致。
