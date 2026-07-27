# 契約摘要:parseInfo(Info.dat 淺解析)

對應原始檔:`src/compile/parseInfo.ts`
另參考:CONTEXT.md「parseInfo」。
**真實來源以 code + docs/ 為準,本檔僅快讀投影。**

---

## 職責

把 `Info.dat` 文字淺解析成 `SongInfo`:取出**難度選單**與**時間換算**所需欄位。純函式,供難度選單與 `compileChart` 共用,使讀檔(I/O)留在編排層(見 docs/adr/0005)。

**淺解析**:只碰 top-level 與 `_difficultyBeatmapSets` 兩層,不讀音符、不做 BPM 時間線正規化(那在 compileChart)。

除解析外,本模組另擁有**「Info.dat 難度清單的查詢」**:依難度身分找出該筆(`findDifficulty`)與其人類可讀標籤(`difficultyLabel`)。放這裡是為了讓 `compileChart` 與 `compileLightShow` 共用同一把尺,不各自複製「怎麼算同一個難度」而漂移(見 GitHub issue #4)。

## 公開介面

```ts
function parseInfo(infoText: string): SongInfo

/** 依難度身分(特性 + 難度名)找出該筆;找不到回 undefined,由呼叫端決定丟錯或退化。 */
function findDifficulty(
  difficulties: readonly DifficultyRef[],
  id: DifficultyId,
): DifficultyRef | undefined

/** 身分 → 人類可讀標籤,如 "Standard ExpertPlus"。錯誤訊息與畫面標題共用。 */
function difficultyLabel(id: DifficultyId): string

/** 難度身分:指定「哪一個難度」的最小資訊。DifficultyRef 結構相容,可直接傳。 */
type DifficultyId = Pick<DifficultyRef, 'characteristic' | 'difficulty'>

interface SongInfo {
  readonly bpm: number;
  readonly songTimeOffset: number;
  readonly audioFilename: string;
  readonly songName?: string;      // 缺/空 → undefined
  readonly coverFilename?: string; // 缺/空 → undefined
  readonly difficulties: readonly DifficultyRef[]; // 非空
}
interface DifficultyRef {
  readonly characteristic: string; // 如 "Standard"
  readonly difficulty: string;     // 如 "ExpertPlus"
  readonly filename: string;       // 如 "ExpertPlusStandard.dat"
}
```

## 行為契約(欄位映射)

| SongInfo 欄位 | Info.dat 來源 | 缺漏處理 |
|---|---|---|
| `bpm` | `_beatsPerMinute` | **必要**:非 number 或 `≤ 0` → 丟錯 |
| `audioFilename` | `_songFilename` | **必要**:非字串或空字串 → 丟錯 |
| `songTimeOffset` | `_songTimeOffset` | 非 number → **預設 0** |
| `songName` | `_songName` | 非字串或空 → `undefined`(呼叫端 fallback) |
| `coverFilename` | `_coverImageFilename` | 非字串或空 → `undefined`(呼叫端用佔位圖) |
| `difficulties` | `_difficultyBeatmapSets[].‌_difficultyBeatmaps[]` | 見下 |

難度展平規則:
- 逐 set 逐 beatmap 攤平;每筆需 `_difficulty`(字串)且 `_beatmapFilename`(字串)俱在,否則**跳過該筆**。
- `characteristic` 取 set 的 `_beatmapCharacteristicName`,缺則預設 `'Standard'`。
- 攤平後**清單為空 → 丟錯**(「未列出任何難度」)。

## 錯誤契約(丟出 Error,訊息清楚)

- 非合法 JSON → `Info.dat 不是合法 JSON`
- 缺有效 `_beatsPerMinute` → 含實得值的錯誤
- 缺 `_songFilename` → `Info.dat 缺少 _songFilename`
- 無任何難度 → `Info.dat 未列出任何難度`

## 難度身分比對契約(findDifficulty)

- **身分 = 特性 + 難度名,兩者都比**。只比難度名會撞名:同一張圖可在多個特性下有同名難度(如 Lightshow 與 Standard 都有 `ExpertPlus`,且 Lightshow 可能排在 Info.dat 前面),只比名字會解析到錯誤的難度檔 → 選了難度卻進不了遊戲 / 燈光靜默消失(GitHub issue #4 的根因)。
- 字串**精確比對**,不做大小寫寬容、不做別名(`Expert+` ≠ `ExpertPlus`)。檔名層級的大小寫寬容在 `SongHandle.readFile`,不在此。
- 有多筆完全同身分時取**第一筆**(Info.dat 本身不該有重複身分;此為穩定退路,非契約承諾)。
- 找不到 → `undefined`。**丟錯與否由呼叫端決定**:`compileChart` 丟錯(音符是必要的),`compileLightShow` 靜默回 `[]`(燈光是選配)。

## 邊界規則

- 只認 v2 底線前綴欄位名(`_beatsPerMinute` 等)。**大小寫不寬容**:欄位名需精確匹配(檔名層級的大小寫寬容在 `SongHandle.readFile`,不在此)。
- `bpm` 必須 `> 0`(0 / 負 / NaN 皆判無效)。
- `songName` / `coverFilename` 空字串視同缺漏(→ `undefined`)。

## 難度選擇(已不在本模組)

難度選擇由 `difficultyMenu.ts`(`buildDifficultyMenu`,issue 17,即遊戲內難度/鍵群選單)負責。舊的 `pickPlayableDifficulty`(單顆預設挑選)在難度選單接手後成為無呼叫端遺留,已隨本次品質審查移除。

## 不變式

- 回傳成功時 `difficulties` 必非空、`bpm > 0`、`audioFilename` 非空。
- 純函式:同文字永得同結果,無 I/O。
- `findDifficulty` 回傳非 undefined 時,該筆必來自傳入清單(含其 `filename`),不自行推導檔名。
