# 品質監管分級台賬

> 分類假設 model 層級:**Opus 4.8(強)**。複雜度是「agent 是否容易犯錯」的判斷,與此層級綁定;換更弱的 model 需重判受影響模組的複雜度。
> 狀態由 `quality-tiering` 的 status 模式維護;reviewed-at 為審查時該模組路徑當下的 commit SHA。
> stale 的判準涵蓋**「路徑」欄 + 「濃縮件」欄兩者**(技能 v1.9.1 起):審 IS/UC 時讀的就是濃縮件,濃縮件變了那次閱讀即失效——即使 source 一行沒動。
> 四格語意見 CLAUDE.md〈品質監管分級〉;概念真實來源在 code 與 docs/,濃縮件只做「給人快讀」的投影。

## 分類表

| 模組 | 路徑 | 格 | 監管方式 | 濃縮件 | reviewed-at | 狀態 |
|---|---|---|---|---|---|---|
| key-assignment | src/compile/keyAssignment.ts | IC | 細讀 code | —（IC 不產） | d47d58b | ok |
| compile-chart | src/compile/compileChart.ts, src/compile/types.ts | IC | 細讀 code | —（IC 不產） | d47d58b | **stale** |
| judge | src/judge/judge.ts, src/judge/types.ts | IC | 細讀 code | —（IC 不產） | d47d58b | ok |
| bpm-timeline | src/compile/bpmTimeline.ts | IS | 讀契約 | docs/quality/bpm-timeline.md | b9e39e9 | ok |
| parse-info | src/compile/parseInfo.ts | IS | 讀契約 | docs/quality/parse-info.md | 0543bd6 | ok |
| mapping | src/compile/mapping.ts | IS | 讀契約 | docs/quality/mapping.md | b9e39e9 | ok |
| scores | src/scores/scores.ts | IS | 讀契約 | docs/quality/scores.md | b9e39e9 | ok |
| backup | src/backup/backup.ts | IS | 讀契約 | docs/quality/backup.md | b9e39e9 | ok |
| light-show | src/compile/lightShow.ts, src/compile/__tests__/lightShow.test.ts | UC | 讀測試摘要判覆蓋 | docs/quality/light-show-tests.md | 0543bd6 | ok |
| loader | src/loader/ | UC | 讀測試摘要判覆蓋 | docs/quality/loader-tests.md | 728ceca | ok |
| difficulty-menu | src/compile/difficultyMenu.ts, src/compile/rawDifficulty.ts | US | 測試綠燈 | — | 0561135 | ok |
| settings | src/settings/settings.ts | US | 測試綠燈 | — | 0561135 | ok |
| audio | src/audio/player.ts | US | e2e / playtest | — | 1db641a | ok |
| preview | src/preview/renderTable.ts | US | e2e / playtest | — | 1db641a | ok |
| highway | src/highway/ | IC | 細讀 code | —（IC 不產） | — | 從未審 |
| app-shell | src/main.ts | IC | 細讀 code | —（IC 不產） | — | 從未審 |

**UC 模組的路徑含測試檔**:UC 的監管方式是「讀測試摘要判覆蓋」,故其濃縮件投影的是**測試**;若路徑只錨 source,「只改測試」時 staleness 會機械顯示 ok 而摘要已過時 ⇒ 監管靜默失效。因此 light-show 的路徑含 `__tests__/lightShow.test.ts`;loader 以資料夾錨定、已含 `__tests__/`,天然滿足。IS(契約文件投影 code)與 IC / US(無濃縮件)不需要。

上面這條管「摘要的真相來源(測試)變了」,表頭那條(stale 涵蓋濃縮件欄)管「摘要自己被改了」。**兩條合起來才封住 IS/UC 的洞**——缺任一條都會有一種改動讓監管靜默失效。新增 UC 模組時記得比照 light-show 把測試檔寫進路徑欄。

**highway 與 app-shell 為何 IC(不是便宜格)**:兩者重要(產品體驗、遊玩流程)且複雜(Three.js / 大型編排 / 過場狀態機),又**難以單元測試**(依 CLAUDE.md 慣例不 mock Three.js / 音訊)。**難測本身不降格**——它只是「該拆」的最強訊號。目前真相邏輯(道 / 列高 / 飛行曲線幾何;倒數 / 暫停 / 重玩狀態機)還埋在難測殼裡,故整模組誠實標 **IC(細讀原 code)**,並把「抽出可測核心」記進〈優化機會〉。playtest-highway 是實跑驗證的技能(verify 用),**不是**本框架的監管濃縮件——IC 的監管就是人細讀 code。

## 明確不監管(排除在四格外)

以下路徑經審視為「無產品真相邏輯的 dev / build 工具」,**刻意不納入四格監管**;記於此以免 status 模式反覆將其當「待 triage」浮出。壞了會在使用當下即時暴露,不需人工監管把關。

| 路徑 | 性質 | 壞掉時的即時訊號 |
|---|---|---|
| `tools/gen-sample-audio.mjs` | dev-only 範例音訊產生器(不出貨) | `npm run gen:audio` 當場報錯 |
| `vite.config.ts` | 建置設定膠水 | `npm run dev` / `build` 當場報錯 |

## 重要度變更紀錄

（尚無。唯一合法觸發:專案需求 / 價值變動導致某模組重要度位移——需在此記下是哪條需求變了,可稽核。不改 code / 需求就想重貼標籤 = 藏風險,拒絕。）

## 優化機會（plan 提出,未實作）

- **scores.ts:抽 `songKey` 雜湊到獨立小模組**。目前雜湊(純機械,可 US)、係數曲線、`applyRun` 規則(IS)混在一檔。切開能讓 IS 面更小。預估:省有限,低優先。
- **[ADR 0014](adr/0014-highway-mainjs-module-split.md) 的 main.ts / highway.ts 拆分已實作完成(the-dev anchored-coding 階段)**:main.ts 拆成流程編排(main.ts)+ 兩個畫面元件(src/screens/landingScreen.ts、src/screens/difficultyScreen.ts);highway.ts 拆成 geometry.ts(純位置數學)、highwayState.ts(純函式 effect reducer,取代原本埋在 highway.ts 裡的狀態機)、hud.ts(純 DOM 殼)、剩餘 highway.ts(Judger 接線 + rAF + effect 執行)。geometry.ts / highwayState.ts 已有 vitest fixtures(`src/highway/__tests__/`);整段流程(進場倒數/暫停/續播/倒數打斷/重新開始/自然播畢/尾段直接結束/判定回饋)已用 playtest-highway 在瀏覽器實跑驗證,行為與重構前一致。**本表格尚未重新分類這些模組的格別與監管方式**——這是 quality-tiering 職責,留待下次執行該技能時依新的檔案結構重判(highway.ts 少了狀態機後有機會降級;新增的 highwayState.ts/geometry.ts 屬 IS,screens/ 兩檔屬 US,皆待正式分類)。
