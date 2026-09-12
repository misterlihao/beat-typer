# 27 — hold 依尾端是否連接真音符分兩種判定

> 來源:GitHub issue #3 · 延伸 08(長按判定)/ ADR 0010 的既有 hold 判定契約

## What to build

現行 `judge` 對所有 `kind:'hold'` 音符一律套用 ADR 0010 的「頭部即時判定 + 尾部破壞點」兩道閘門,提早放開一律 Miss。但弧線(slider)的尾端不一定對應一顆真的音符——比照 Beat Saber 官方 arc 機制,尾端座標(拍/欄/列/顏色)若剛好與一顆 `colorNote` 重合,才算「真的要打」;沒有重合的尾端只是曲線終點,不應該要求玩家撐住。

依此把 hold 分兩種判定路徑:

- **有尾部判定**(尾端與 colorNote 重合):行為與現行 ADR 0010 完全一致,不變。
- **無尾部判定**(尾端沒有重合):頭部命中當下依 perfect/good 定案,等同 press——之後放不放開都不影響判定 / combo / 準確率,不會被判 Miss、不會斷 combo。

**音效**:
- 頭部命中 tick(依 perfect/good 分高低音)兩種 hold 都不變。
- 尾部完成 tick(現行 `playTick('high')`)只有「有尾部判定」的 hold 在尾部鎖定時播;「無尾部判定」不播。
- **新增**:頭部命中後到放開/鎖定/破為止,播一個跟 tick 不同音色的**持續音**,兩種 hold 都有;停止時機比照現行「按住中目標格持續發光」的生命週期(放開鍵、或音符被鎖定/被判破,持續音跟著停)。

**視覺**:「無尾部判定」的長按長條做成半透明,與「有尾部判定」的長條在敲之前就能用眼睛分辨。

**文字/表格預覽**(`src/preview/renderTable.ts`):新增一欄標示每顆 hold 是否有尾部判定。

## 不受影響 / 明確排除

- 鏈條(v3 `burstSliders`)仍整組濾除,不參與此功能;PRD 既有「未來展開成連打」規劃不動。
- v2 弧線仍不支援(既有限制)。
- 資料來源就是既有的 `sliders` + `colorNotes` 陣列,不需要新的譜面資料欄位或外部設定。

## Acceptance criteria

- [x] 弧線尾端座標與某顆 `colorNote`(同 beat/欄/列/顏色)重合 → 判定行為與現行 hold 完全一致(不回歸)
- [x] 弧線尾端座標不與任何 `colorNote` 重合 → 頭部命中即定案,之後任意時間放開(含完全不放開)皆不影響判定 / combo / 準確率,不產生 Miss
- [x] 有尾部判定的 hold 尾部鎖定時播放完成 tick;無尾部判定的 hold 全程不播完成 tick
- [x] 兩種 hold 頭部命中後皆播放持續音(區別於 tick 的音色),於放開 / 鎖定 / 破時停止
- [x] 無尾部判定的 hold 提早放開只停止持續音,不觸發紅色破壞回饋、不閃 Miss
- [x] 3D 渲染:無尾部判定的長按長條為半透明,與有尾部判定的長條可視覺區分
- [x] 文字/表格預覽新增「有無尾部判定」欄,並與 `compileChart` 輸出一致
- [x] fixture 測試涵蓋:尾端重合 / 不重合各自的判定路徑、提早放開行為差異
- [x] tsc / build 乾淨;既有測試不回歸

## Blocked by

- 08 — 長按判定(ADR 0010,本 issue 延伸其判定契約)
- 03 — 同拍 burst + 內側鍵 + 弧線長按 + 特殊元素過濾(弧線→hold 的既有轉換邏輯)

## 設計定案(2026-09-12,the-dev design-progressively)

**詞彙(CONTEXT.md 待補)**:「長按 (Hold)」維持同一個詞不拆分;新增屬性節點**「尾部判定 (Tail Judgment)」**——`true`(現行行為不變:破壞點規則 + 完成音)/ `false`(頭部命中即定案,不受放開時機影響,不播完成音)。CONTEXT.md 的「持續段/破壞點/鎖定」三詞的定義補註「僅適用於尾部判定=true 的長按」。「判定 (Judgment)」的 Miss 條件註記改為「…或**有尾部判定**的長按提早放開」。

**判斷依據**:`compileChart` 的 `normalizeV3()` 對每顆弧線(hold),檢查其尾端座標 `(tb,tx,ty,c)` 是否與某顆 `colorNotes` 重合——重合→`tailJudged:true`;不重合→`tailJudged:false`。與現行「濾除重合 colorNote」的 `occupied` 檢查同源,不新增資料來源。

**型別**:`Note` 新增 `readonly tailJudged?: boolean`,比照既有 `holdEndSec?` 的慣例——只在 `kind:'hold'` 時有意義,`kind:'press'` 時不存在。

**`judge.ts`(Judger)機制**:完全重用現行「一個判定單位、兩道閘門」模型(ADR 0010),不另開判定路徑:
- `press()` 命中 hold 頭部:不論 `tailJudged`,一律進 `activeHolds`、當場 `bumpCombo()`,行為不變。
- `release()`:`tailJudged:false` 的 hold,略過「提早放開 → 破」那個分支,永遠視為「安全放開」(等同現行『撐過破壞點』的結果),不寫 Miss、不斷 combo。`tailJudged:true` 行為完全不變。
- `expiry()` 的尾部自動鎖定迴圈不變,兩種 hold 都在 `holdEndSec` 由同一段邏輯定案——這是唯一的「定案」時機,不因 `tailJudged` 而異。

**`highway.ts` 機制(新舊生命週期拆兩條追蹤)**:
- `heldNotes` 的 value 由 `'perfect'|'good'` 擴充為 `{ result: 'perfect'|'good', released: boolean }`。
- `onKeyUp` 改為讀 `judger.release(...)` 的回傳值(現行直接丟棄,改為使用):收到 `'safe'`(含 tailJudged=false 的必然安全放開)→ 立刻 `brightenBody(idx,false)` + 停止持續音(fade-out ramp),並把該筆 `released` 設為 `true`,**但不從 `heldNotes` 移除**。收到 `'break'` 不特別處理(現行「下一幀由 `resultAt` 轉態偵測」的路徑本來就即時,`results[i]` 在 `release()` 內同步寫入)。
- 每幀渲染迴圈(現行 486-503 行)讀 `heldNotes`:`r===null` 時,只有 `released===false` 才繼續「目標格持續發光」;`released===true` 則什麼都不做,靜靜等待真正定案。`r!==null`(真正定案,不論早或晚)時的收尾邏輯不變——刪除 `heldNotes` 該筆、`brightenBody(idx,false)`、依 `chart[idx].tailJudged` 決定要不要播放完成音 `playTick('high')`(`false` 則跳過)、依 miss/命中決定紅閃或金脈衝。
- **完成音與金色鎖定脈衝的觸發時機不隨此功能改變**——維持 ADR 0010 原有的「對齊鎖定時機、不綁物理 keyup」,這是刻意保留、不是遺漏。

**持續音合成**(`audio/player.ts` 新增方法,對應 tick 的合成風格但改為可持續):固定頻率的持續振盪器(音色與 tick 的三角波明顯不同,例如正弦波,頻率遠低於 tick 的 1150-2000Hz 區間),`start()` 時快速淡入、`stop()` 時快速淡出(數十 ms ramp 避免喀聲),兩種 `tailJudged` 皆同一音色/邏輯,不分 high/low。音量共用現行 `tickVolume`,不新增獨立滑桿與 settings 欄位。

**視覺**:`tailJudged:false` 的 hold body 材質設半透明(`transparent:true` + 一個 opacity 值,具體數值由實作時微調,非設計決策)。

**預覽表格**(`src/preview/renderTable.ts`):新增一欄「尾部判定」,值顯示「有」/「無」(僅 hold 列有值,press 列留空,比照現行 kind/holdEnd 欄的處理方式)。

## 架構定案(2026-09-12,the-dev architecture-design)

所有新邏輯都落進既有模組節點,沒有新開節點,判斷皆可由「必須共同保持正確」的判準 100% 推出,不需使用者裁決:

- **持續音 start/stop → `AudioPlayer`(src/audio/player.ts),`playTick` 旁加新方法。** 與 `playTick` 共用同一份私有狀態(`ctx`/`tickVolume`/`ensureCtx()`),AudioContext 接線方式改動時兩者必然一起動,拆開只會被迫重新取得私有狀態、破壞封裝。
- **hold 生命週期追蹤(`released` 旗標 + 每幀輪詢)→ 留在剩餘 `highway.ts`(組裝層),不比照 `highwayState.ts` 抽成純函式。** ADR 0014 抽 `highwayState.ts` 是因為那段狀態機有自己獨立的決策脈絡(issue 13 等),變動原因與渲染/音效細節無關。這次的生命週期追蹤本質是「Judger 判定狀態轉變時該呼叫哪個渲染/音效函式」,變動原因永遠是渲染/音效需求本身(這次功能即是實例),與「組裝」職責定義吻合,沒有獨立脈絡值得抽離,抽出來也換不到可測性。
- **`tailJudged` 判斷邏輯 → 留在 `compileChart.ts` 的 `normalizeV3()` 內部**,延伸既有的 `occupied` 座標比對(同一份資料上的同一個問題,只是多留一個布林值),不新增檔案或模組;可在檔案內部拆一個私有 helper 共用比對邏輯,但不算新的模組樹節點。

**資料流不需新增介面**:`tailJudged` 沿用 `Note` 既有欄位直接傳遞的既有模式(比照 `kind`/`holdEndSec`,compile → judge/highway/preview 各自直接讀 `chart[i]`),`PressOutcome`/`ReleaseOutcome` 皆不用變動。

## 實作狀態

已於 the-dev anchored-coding 階段(2026-09-12)完成落地:

- `Note.tailJudged?: boolean`、`compileChart.ts` 的 `normalizeV3()` 判斷邏輯、`judge.ts` 的 `release()` 分流、`highway.ts` 的雙生命週期追蹤(`released` 旗標)、`preview/renderTable.ts` 新欄、CONTEXT.md 詞彙,皆按設計/架構定案原樣實作,無需求異動。
- **持續音的控制把手型別命名為 `HoldTone`(非 `Sustain`)**:落地時發現若沿用「Sustain」會撞名——CONTEXT.md 既有「持續段 (Sustain)」節點另指長按頭到尾的區段,語意不同;改名避免同一英文詞在同個功能裡指兩件事。方法名 `startHoldTone()`。
- **落地時發現並補上設計階段沒討論到的邊界**:持續音是獨立的 Web Audio 節點,不會跟著 rAF 迴圈的暫停/停止自動靜音——若不處理,暫停中、重玩、卸載、或自然播畢時仍在響的持續音會變成孤兒音源一直響下去。已在 `pause`/`launch(resume)`/`finish`/`resetForNewRun`/卸載函式五處補上對應的 `stop()`(暫停時停音但保留 `heldNotes` 供續玩重啟;其餘四處是保底清理)。
- 200+ vitest fixture 綠(`compileChart.test.ts` 新增尾端重合/不重合/顏色不同三案,`judge.test.ts` 新增 `tailJudged:false` 完整判定路徑五案),tsc / build 乾淨。
- **playtest-highway 實跑驗證**(擴充 `?holdtest` DEV 合成譜面,新增第三顆 `tailJudged:false` 的長按 C,與既有 A/B 對照;同步更新 `.claude/skills/playtest-highway/SKILL.md` 的說明):
  - 監測 `playTick`/`startHoldTone` 呼叫時序(monkey-patch 記錄),證實:A(有尾部判定)提早放開之外的安全放開 + 尾部鎖定時恰好響一聲完成音;C(無尾部判定)頭部命中即記入 combo,即使極早放開也不產生 Miss、不斷 combo,且尾部鎖定時**不**響完成音;B(有尾部判定)提早放開正常判 Miss、紅閃、斷 combo(無回歸)。
  - 持續音把手的 `stop()` 時間點證實對齊玩家實際放開鍵的當下(而非等到尾部真正定案),A/C/B 三者皆準確在各自的放開時刻停止。
  - 表格預覽正確顯示「尾部判定」欄:A/B=有、C=無。
  - 暫停畫面截圖下可見 D/F 兩條半透明/不透明的長條沿走廊飛行,肉眼可辨(暫停覆蓋層本身會整體調暗,細節見截圖)。
  - 全程 console 無 error。

## 品質審核(2026-09-12,the-dev haoli-review)

逐檔審過改動(compile/judge/highway/audio/preview 五層 + 測試),對照〈設計定案〉〈架構定案〉逐一核對意圖聲明與實作是否一致、有無遺漏邊界、有無過度工程。結論:核心行為程式碼(型別穿透、`judge.ts` 分流、`highway.ts` 雙生命週期、`audio/player.ts` 持續音)正確、無回歸、無過度設計,`heldNotes` 各處清理(pause/resume/finish/reset/卸載)覆蓋完整,沒有孤兒音源風險。

**審核中發現並已修正的落差**:`docs/PRD.md`(CLAUDE.md 指定的「判定契約」真實來源)的 hold 判定敘述(story 29、映射契約段落、測試案例段落共 4 處)在實作前就已寫成「長按一律要求持續按住」,實作完成後沒同步——這是宣告意圖(PRD 文件)與實際行為(現在分兩種)產生落差,已比照 story 14 的既有寫法(指向 ADR 的括號註記)逐處補上「見 docs/adr/0010、issue 27」的說明,不改動其餘與本次改動無關的既有內容(PRD 映射表段落本身已有更早的、與本次無關的過時之處,不在本次審核範圍內,不動)。同步在 ADR 0010 補一段〈延伸〉,讓直接查到該 ADR 的讀者也能找到 issue 27。

**維護性微調**:`highway.ts` 的 `heldNotes` 型別原本是內嵌的匿名物件型別;比照專案既有慣例(`keyAssignment.ts` 的 `Occupancy`、同檔案的 `NoteVisual` 皆為具名 interface),改為具名的 `HeldHoldState`,可讀性更好、不算新增邏輯。

**未發現的問題類型**:過度工程(額外邊界清理皆對應真實會發生的孤兒音源風險,非臆測)、判定/渲染邏輯遺漏(playtest 實跑 + fixture 雙重驗證涵蓋所有分支)、與既有契約衝突(除上述 PRD 落差外,ADR 0010 核心模型、CONTEXT.md 既有詞彙皆相容)。

tsc / 229 測試 / build 於審核修正後重新跑過,皆綠。

## 需求分析記錄(2026-09-12,the-dev grilling)

- 判斷依據的來源(是鏈條、還是弧線本身的屬性)一開始不確定,曾懷疑是鏈條;查證 Beat Saber 官方 arc 機制後確認是弧線本身尾端是否連接真音符,與鏈條無關,PRD 既有鏈條規劃不受影響。
- 「無尾部判定=完全等同 press」vs「放寬破壞規則但仍要求不能太早放開」兩案曾並列;使用者選前者,理由未深究但已定案,不再反覆。
- 「不要出聲音」原始需求在釐清後,實際落地成「新增一個持續音、只有尾端完成 tick 因類型而異」——比原始需求描述的範圍更大(新增了現行完全沒有的持續音機制),記於此以免日後誤讀 issue 原文以為範圍只有「消音」。
- 視覺差異(半透明)與預覽表格新增欄位是需求分析階段主動提出、經使用者確認要做,不是 issue 原文明講的項目。
