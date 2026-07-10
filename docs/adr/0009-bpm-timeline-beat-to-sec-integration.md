# beat→秒改為分段 BPM 積分;難度檔的 BPM 時間線凌駕 Info.dat BPM

**Status:** accepted

`compileChart` 的 beat→秒換算從「單一 `60/info.bpm` 平乘」改為**分段常數 BPM 的積分** `beatToSec(beat)`。BPM 時間線從**難度檔**讀出:v3 `bpmEvents`、v2 `_customData._BPMChanges`,兩者正規化成同一份排序 `[{beat, bpm}]`。Info.dat `_beatsPerMinute` 只當「首事件之前」與「無時間線」的基準,**不凌駕**時間線。

## 為何記錄

兩點違反直覺、且不可輕易反轉(動了核心時間模型):

1. **忽略 Info.dat 的 BPM**:參考譜 Masquerade 的 Info `_beatsPerMinute=128`,但 `bpmEvents` 從 `120` 起。我們以難度檔時間線為準(該段用 120),Info BPM 只是**顯示值**。未來讀者會問「為何不用 Info 的 BPM」。
2. **支援 v2 非官方欄位 `_customData._BPMChanges`**:這是編輯器(MMA2 等)的擴充,非官方 schema。我們刻意納入,因為真實譜庫大量使用它,且其時間模型與 v3 `bpmEvents` 相同(分段常數積分),邊際成本小。

## 關鍵推理

- BPM change 是分段常數:區段 `[b_i, b_{i+1})` 以 `m_i` 播放。真實時間 = 各區段 `Δbeat × 60/BPM` 之和。等速平乘會讓變速點後的落點與音樂錯開。
- v2 與 v3 的差異只在「從哪個欄位讀、欄位名」;正規化成統一 `[{beat,bpm}]` 後,`beatToSec` 與積分邏輯格式無關,只寫一次。
- determinism / 純函式不變:時間線與 `beatToSec` 皆由難度檔決定,無 I/O、無 RNG。疊放分組仍在 beat 空間,不受變速影響。

## 被否決 / 排除

- **Info BPM 為準**:等於不支援變速,參考譜落點錯。
- **Info BPM 與時間線不一致就報錯**:真實譜常不一致(Info 是顯示 BPM),會誤殺大量正常譜。
- **v2 `BPMInfo.dat` / type-100 events**:另一套機制,無測試素材,暫不支援(退回時間線/常數);未來可加。

## 連帶影響

- `collapseStacks` 與 holds 換算改用 `beatToSec(beat) + songTimeOffset`(原為 `beat × secPerBeat + offset`)。
- 驗證:合成 v2+v3 fixtures(多段積分、單段=常數不回歸、首事件 beat>0、hold 跨邊界、缺/空回退)為單元關卡;`Idol (Comyute)`(v2 曲中多段變速)為強實測譜。
