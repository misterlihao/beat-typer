# 品質監管分級台賬

> 分類假設 model 層級:**Opus 4.8(強)**。複雜度是「agent 是否容易犯錯」的判斷,與此層級綁定;換更弱的 model 需重判受影響模組的複雜度。
> 狀態由 `quality-tiering` 的 status 模式維護;reviewed-at 為審查時該模組路徑當下的 commit SHA。
> 四格語意見 CLAUDE.md〈品質監管分級〉;概念真實來源在 code 與 docs/,濃縮件只做「給人快讀」的投影。

## 分類表

| 模組 | 路徑 | 格 | 監管方式 | 濃縮件 | reviewed-at | 狀態 |
|---|---|---|---|---|---|---|
| key-assignment | src/compile/keyAssignment.ts | IC | 細讀 code | —（IC 不產） | — | 從未審 |
| compile-chart | src/compile/compileChart.ts, src/compile/types.ts | IC | 細讀 code | —（IC 不產） | — | 從未審 |
| judge | src/judge/judge.ts, src/judge/types.ts | IC | 細讀 code | —（IC 不產） | — | 從未審 |
| bpm-timeline | src/compile/bpmTimeline.ts | IS | 讀契約 | docs/quality/bpm-timeline.md | — | 從未審 |
| parse-info | src/compile/parseInfo.ts | IS | 讀契約 | docs/quality/parse-info.md | — | 從未審 |
| mapping | src/compile/mapping.ts | IS | 讀契約 | docs/quality/mapping.md | — | 從未審 |
| scores | src/scores/scores.ts | IS | 讀契約 | docs/quality/scores.md | — | 從未審 |
| backup | src/backup/backup.ts | IS | 讀契約 | docs/quality/backup.md | — | 從未審 |
| light-show | src/compile/lightShow.ts | UC | 讀測試摘要判覆蓋 | docs/quality/light-show-tests.md | 728ceca | ok |
| loader | src/loader/ | UC | 讀測試摘要判覆蓋 | docs/quality/loader-tests.md | 728ceca | ok |
| difficulty-menu | src/compile/difficultyMenu.ts, src/compile/rawDifficulty.ts | US | 測試綠燈 | — | 0561135 | ok |
| settings | src/settings/settings.ts | US | 測試綠燈 | — | 0561135 | ok |
| audio | src/audio/player.ts | US | e2e / playtest | — | — | 從未審(待 playtest) |
| preview | src/preview/renderTable.ts | US | e2e / playtest | — | — | 從未審(待 playtest) |
| highway | src/highway/ | IC | 細讀 code | —（IC 不產） | — | 從未審 |
| app-shell | src/main.ts | IC | 細讀 code | —（IC 不產） | — | 從未審 |

**highway 與 app-shell 為何 IC(不是便宜格)**:兩者重要(產品體驗、遊玩流程)且複雜(Three.js / 大型編排 / 過場狀態機),又**難以單元測試**(依 CLAUDE.md 慣例不 mock Three.js / 音訊)。**難測本身不降格**——它只是「該拆」的最強訊號。目前真相邏輯(道 / 列高 / 飛行曲線幾何;倒數 / 暫停 / 重玩狀態機)還埋在難測殼裡,故整模組誠實標 **IC(細讀原 code)**,並把「抽出可測核心」記進〈優化機會〉。playtest-highway 是實跑驗證的技能(verify 用),**不是**本框架的監管濃縮件——IC 的監管就是人細讀 code。

## 重要度變更紀錄

（尚無。唯一合法觸發:專案需求 / 價值變動導致某模組重要度位移——需在此記下是哪條需求變了,可稽核。不改 code / 需求就想重貼標籤 = 藏風險,拒絕。）

## 優化機會（plan 提出,未實作）

- **scores.ts:抽 `songKey` 雜湊到獨立小模組**。目前雜湊(純機械,可 US)、係數曲線、`applyRun` 規則(IS)混在一檔。切開能讓 IS 面更小。預估:省有限,低優先。
- **app-shell(main.ts,IC):抽「倒數 / 暫停 / 重玩」狀態機成純函式接縫**。目前狀態機(真相邏輯)埋在 ~600 行編排裡,把整個 main.ts 釘在 IC。抽成純函式(輸入事件 → 狀態)後:狀態機 → **IS + 可單元測試**、剩下的載入/切頁膠水(無真相邏輯的薄殼)→ **US**。預估:把 main.ts 整個移出 IC,IC 少一次細讀。值得,屬 issue 級重構。
- **highway(src/highway/,IC):抽 `src/highway/geometry.ts`(純)**。把 `KEY_LAYOUT`/`buildLayout`、`laneX`/`rowY`/`liftAt`、`comboTier`,以及「音符 tSec + 音訊時鐘 → 判定平面 Z / 飛行位置」的位置數學抽成純函式。這是 highway 裡最會「靜默算歪」的真相邏輯(道 index、列高 off-by-one、飛行曲線),現埋在難測殼裡→整檔 IC。抽出後 → **IS/US 可斷言**;是把 highway 移出 IC 的**主切分**。
- **highway(src/highway/,IC):抽 DOM 建構 helpers 到 `src/highway/hud.ts`**(buildControls / buildPauseOverlay / buildCountdown / buildFeedback / buildInfoCard / makeGlyphSprite / buildTargetGrid)。這些是無真相邏輯的純視圖薄殼 → **US**。把它們移出後,IC 細讀面再縮一截。與 geometry 兩刀切完,highway.ts 只剩動畫迴圈 + Judger 接線 + 事件派發的膠水殼(→ US,可 playtest 當綠燈)。
