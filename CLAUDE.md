**使用繁體中文回應**

# Beat Typer

把 Beat Saber 譜面轉成 3D 節奏打字練習:每顆音符依「顏色→手 / 欄→手指 / 列→鍵盤上中下排」唯一對應到一個鍵盤鍵。

## 真實來源(動手前先讀對應檔,勿在此複製其內容)
- 需求 / 映射表 / 判定契約:docs/PRD.md
- 詞彙表(概念定義,對外用語以此為準):CONTEXT.md
- 架構決策:docs/adr/
- 切片任務規格:docs/issues/
- 進度 / issue 追蹤:一律用 task-tracker 技能(不接外部 tracker);進度在 ~/.claude/projects/d--workspace-beat-typer/tasks/TASKS.md

## 架構核心
- 兩個純函式測試接縫:`compileChart`(原始譜面 → TypingChart,主接縫)、`judge`(按鍵事件 → 判定 + summary,次接縫)。二者皆不含 I/O、音訊、渲染。
- 載入(內建 / zip / CustomLevels)與 3D 渲染都是薄層:只搬位元組與畫面,不放遊戲邏輯。
- 用語紀律:對外一律用 CONTEXT.md 的詞(欄 / 列 / 顏色 / 排…),避免原始欄位名(lineIndex / lineLayer / type)。

## 指令
- 測試:`npm test`(vitest 一次性)· `npm run test:watch`
- 開發:`npm run dev` · 建置:`npm run build` · 產生範例音訊:`npm run gen:audio`

## 慣例
- 測試只測外部行為:以手寫 fixtures 斷言純函式輸出,不 mock 檔案系統 / 音訊 / Three.js。
- 建置順序:① 載入層做齊(含文字/表格預覽驗證映射與音同步)→ ② 3D 遊戲。
- **在瀏覽器實跑/驗證遊戲(高速公路、判定、回饋)時,用 `playtest-highway` 技能**——內含關鍵時序陷阱(chrome-devtools `click` 與後續 `evaluate` 的牆鐘落差會讓短歌先播完)與「音訊時鐘對齊」自動打技法。別用牆鐘 `setTimeout` 排程自動打(會全 MISS)。

## 品質監管分級(quality-tiering)
每個模組依「重要度 × 複雜度」歸一格,監管方式見 `docs/quality-map.md`:
IC 重要複雜→細讀 code｜IS 重要簡單→讀契約文件｜UC 不重要複雜→讀測試摘要判覆蓋｜US 不重要簡單→測試綠燈。
**agent 常駐義務:**
- 動到某模組時,若改動會**拉高它的格**(變複雜 / 變重要 / 破公開契約)→ 主動指出並提「重判分級」,別默默改。
- 動到 IS / UC 模組 → **刷新它的濃縮件(契約文件 / 測試摘要)算進「done」**。
- 分類假設了 model 層級(記在台賬);**換到更弱的 model** 時,受影響模組要重判複雜度。
- staleness 由 git 機械算(`quality-tiering` 的 status 模式),agent 不必手動維護台賬狀態。
- 專案需求變動導致某模組**重要度**改變 → 這是唯一「不改 code 也能重分級」的情況,且要在台賬〈重要度變更紀錄〉記原因。
