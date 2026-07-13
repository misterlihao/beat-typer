# beat→秒改為分段 BPM 積分;難度檔的 BPM 時間線凌駕 Info.dat BPM

**Status:** accepted(2026-07-13 修正:v2 `_customData._BPMChanges` 改為**不換算**——見下方「修正」)

`compileChart` 的 beat→秒換算從「單一 `60/info.bpm` 平乘」改為**分段常數 BPM 的積分** `beatToSec(beat)`。BPM 時間線從**難度檔**讀出:僅 v3 `bpmEvents`,正規化成排序 `[{beat, bpm}]`。Info.dat `_beatsPerMinute` 只當「首事件之前」與「無時間線」的基準,**不凌駕**時間線。

## 修正(2026-07-13):v2 `_customData._BPMChanges` 不參與換算

本 ADR 原把 v2 `_customData._BPMChanges` 與 v3 `bpmEvents` 當**同一套**時間模型一起積分。這是錯的,已改為 v2 一律等速。

- **根據**:`_BPMChanges` 是 MMA2 等**編輯器**的顯示用擴充,**Beat Saber 本體不讀**;本體對 v2 只用單一 Info BPM 播放。已發佈的 v2 譜(能在本體正常遊玩)其音符 `_time` 必然已在「固定 Info BPM 拍空間」——再拿 `_BPMChanges` 去分段積分等於重複套用,把落點算歪。
- **鐵證**:`God-ish (TOFU)`(v2、bsr 2e5ca、變速 142→103→142),音訊 205.4s。積分模型把末音符推到 **215.8s**(超出音訊 10s,後段音符全亂);忽略 `_BPMChanges`、等速 142 則為 **201.6s**,吻合。此即原 issue 10「Idol 末音符 216.1s vs 音訊 214s ~2s 超出」同一 bug 的放大版。
- v3 `bpmEvents` 是官方欄位、本體會吃,維持積分不變。v2≠v3:兩者不再共用時間線來源。

## 為何記錄

兩點違反直覺、且不可輕易反轉(動了核心時間模型):

1. **忽略 Info.dat 的 BPM**:參考譜 Masquerade 的 Info `_beatsPerMinute=128`,但 `bpmEvents` 從 `120` 起。我們以難度檔時間線為準(該段用 120),Info BPM 只是**顯示值**。未來讀者會問「為何不用 Info 的 BPM」。
2. ~~**支援 v2 非官方欄位 `_customData._BPMChanges`**~~:**已於 2026-07-13 撤銷**(見上方「修正」)。當初誤以為其時間模型與 v3 `bpmEvents` 相同;實際上本體不讀它,積分會把落點算歪。v2 一律等速。

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
