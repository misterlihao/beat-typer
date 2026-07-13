# 10 — 帶 BPM change 的譜面(變速)時間換算

> 來源:使用者需求 + 參考譜面。
> **狀態:設計已收斂(2026-07-11)。決策見 docs/adr/0009 與 CONTEXT「變速」。**
> **2026-07-13 修正:v2 `_customData._BPMChanges` 撤出 scope——本體不讀,積分會把落點算歪(`God-ish TOFU` 末音符飄 10s)。改為 v2 一律等速,只有 v3 `bpmEvents` 積分。詳見 docs/adr/0009「修正」。下方 v2 相關 AC 已作廢。**

## 問題

`compileChart` 現在用**單一** `secPerBeat = 60 / info.bpm` 把 beat 平乘成秒(collapseStacks / holds 兩處),假設全曲等速。真實譜面常有 **BPM change**(分段常數:區段 `[b_i, b_{i+1})` 以該段 BPM 播放)。等速換算會讓變速點之後的音符落點與音樂對不上。

兩種來源、同一模型:
- **v3**:難度檔頂層 `bpmEvents: [{ b: beat, m: bpm }]`。(參考譜 `5277c (Masquerade)`:`[{0,120},{5,128}]`。)
- **v2**:難度檔 `_customData._BPMChanges: [{ _time: beat, _BPM: bpm, ... }]`。(參考譜 `316ed (Idol - Comyute)`:曲中 166→155→150→…→166,音符跨遍所有變速點。)

## What to build

把 beat→秒換算從「單一 secPerBeat 平乘」改成支援**分段 BPM 的積分函式** `beatToSec(beat)`(純函式,仍在 compileChart 內、無 I/O):

- **BPM 時間線**(格式無關的中繼):在 v2/v3 正規化時各自讀出並正規化成排序後的 `[{ beat, bpm }]`——v3 讀 `bpmEvents`(b→beat, m→bpm),v2 讀 `_customData._BPMChanges`(_time→beat, _BPM→bpm)。
- `beatToSec(B)` = 累加各區段 `(該區段涵蓋的 beat 數) × 60 / 區段BPM` 直到 B。
- **基準/回退**:時間線為空或缺 → 退回 `info.bpm` 常數(與現行行為一致,不回歸)。第一個事件 beat > 0 時,`[0, 首事件beat)` 以 `info.bpm` 計。`info.bpm`(Info.dat `_beatsPerMinute`)僅作此基準,不凌駕時間線(見 ADR 0009:Info BPM 是顯示值,時間線才是權威)。
- press、hold head、hold tail 的 tSec 全部改經 `beatToSec`;`songTimeOffset` 照舊最後加。
- **健壯**:防禦性依 beat 排序;忽略缺欄位或 `bpm ≤ 0` 的項;非陣列/空 → 常數回退。
- 疊放分組維持在 **beat 空間**(`STACK_BEAT_THRESHOLD` 單位是 beat,不受變速影響);只有「beat→秒」這一步改變。

I/O / 渲染不變;這是純 compile 層的時間正確性修正。

## Acceptance criteria — 達成 ✅(2026-07-11)

- [x] v3 `bpmEvents` 譜面:每顆音符 tSec = 依分段 BPM 積分(fixtures 斷言 120→60 多段)
- [x] v2 `_customData._BPMChanges` 譜面:同一積分模型(fixtures + Idol 實跑)
- [x] 無變速(時間線空/缺)→ 與現行常數換算逐一相等(既有 fixtures 不回歸;75 測試全過)
- [x] 首事件 beat>0 其前以 `info.bpm`;`info.bpm`≠時間線起始值時以時間線為準(fixtures:info=128 但 [{0,120}]→beat2=1.0s)
- [x] hold head/tail 皆依變速換算,含跨 BPM 邊界(fixtures 斷言)
- [x] v2+v3 fixtures:多段積分、單段=常數、事件不從 0 起、hold 跨邊界、缺/空回退、健壯(bpm≤0/缺欄位忽略)
- [x] 強實測:`Idol (Comyute)`(v2、8 段、beat 588)——**數值鐵證** beatToSec 與獨立重算逐 beat 吻合(<1e-9),對常數的**曲末漂移 3.54s**;瀏覽器端到端載入/編譯/播放/渲染無錯
- [ ] **待人耳確認**:Idol 曲中變速段落聽感對拍(自動化只能證積分數學正確,無法證 `_BPMChanges` 詮釋吻合音訊;末音符 216.1s vs 音訊 214s 有 ~2s 超出,值得聽一下尾段)

**實作**:src/compile/bpmTimeline.ts(buildBeatToSec)+ compileChart 讀 v2/v3 時間線。

## Blocked by

- 02 — v2/v3 正規化(時間線在正規化時一併讀出)。

## Out of scope（v1 不處理,記錄以免誤解）

- **v2 `BPMInfo.dat`**(官方新編輯器的 audio-time↔beat 映射檔)與 **type-100 events**:另一套機制,無測試素材,暫不支援;遇到時退回時間線/常數。
- 曲中 BPM 顯示 / 變速視覺提示(純時間換算即可讓落點正確)。
