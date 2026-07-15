# 契約摘要:parseInfo(Info.dat 淺解析)

對應原始檔:`src/compile/parseInfo.ts`
另參考:CONTEXT.md「parseInfo」。
**真實來源以 code + docs/ 為準,本檔僅快讀投影。**

---

## 職責

把 `Info.dat` 文字淺解析成 `SongInfo`:取出**難度選單**與**時間換算**所需欄位。純函式,供難度選單與 `compileChart` 共用,使讀檔(I/O)留在編排層(見 docs/adr/0005)。

**淺解析**:只碰 top-level 與 `_difficultyBeatmapSets` 兩層,不讀音符、不做 BPM 時間線正規化(那在 compileChart)。

## 公開介面

```ts
function parseInfo(infoText: string): SongInfo

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

## 邊界規則

- 只認 v2 底線前綴欄位名(`_beatsPerMinute` 等)。**大小寫不寬容**:欄位名需精確匹配(檔名層級的大小寫寬容在 `SongHandle.readFile`,不在此)。
- `bpm` 必須 `> 0`(0 / 負 / NaN 皆判無效)。
- `songName` / `coverFilename` 空字串視同缺漏(→ `undefined`)。

## 難度選擇(已不在本模組)

難度選擇由 `difficultyMenu.ts`(`buildDifficultyMenu`,issue 17,即遊戲內難度/鍵群選單)負責。舊的 `pickPlayableDifficulty`(單顆預設挑選)在難度選單接手後成為無呼叫端遺留,已隨本次品質審查移除。

## 不變式

- 回傳成功時 `difficulties` 必非空、`bpm > 0`、`audioFilename` 非空。
- 純函式:同文字永得同結果,無 I/O。
