# highway.ts 拆四塊、main.ts 拆「畫面元件／流程編排」

**Status:** accepted,**實作已完成**(the-dev anchored-coding 階段,2026-09-12;見下方〈實作狀態〉)

品質監管台賬(`docs/quality-map.md`)標記 `highway`(src/highway/)與 `app-shell`(src/main.ts)兩個 IC 模組「從未審」。the-dev 架構審視階段(2026-09-12)細讀兩檔後,做出以下模組樹拆分決策。

## 決策

1. **highway.ts(1135 行)拆四個節點,依「業務變動方式是否互相綁定」判定,不需使用者裁決:**
   - `geometry.ts`(純函式):`KEY_LAYOUT`/`buildLayout`、`laneX`/`rowY`/`liftAt`、`comboTier` 等位置數學。
   - `highwayState.ts`(新提案,純函式):遊戲狀態機 `idle → countdown → playing ⇄ paused → ended` 及其轉移規則(highway.ts:475-846)。輸入現有狀態 + 事件(按鍵/分頁切背景/自然播畢/尾段全判定完)→ 輸出新狀態 + 該觸發的效果清單。
   - `hud.ts`(純視圖殼):`buildControls`/`buildPauseOverlay`/`buildCountdown`/`buildFeedback`/`buildInfoCard`/`buildTargetGrid` 等 DOM 建構,無真相邏輯。
   - 剩餘 `highway.ts`:Judger 接線 + rAF 動畫迴圈(用 geometry.ts 算音符位置)+ 把 state 效果接上實際副作用(音訊/DOM/計時器)+ 輸入事件派發進狀態機。職責是「組裝」,不含業務真相。

2. **main.ts(600 行)拆成「畫面元件」與「流程編排」兩個節點:**
   - 畫面元件(Landing、DifficultyScreen):純 DOM 樣板渲染 + 使用者互動事件,不含跨畫面資料流轉決策。
   - 流程編排(bootstrap / startSong / mountViews):決定該顯示哪個畫面、資料如何在畫面間流轉,包含**難度檔快取**(`showDifficultyScreen` 預讀所有難度檔算 WPM 存的 `cache`,選定後 `startSong` 直接重用 `cachedDiffText`)。快取歸流程編排層,因為它服務的是「song/session 生命週期內免重讀」這個跨畫面的流程關注點,不是單一畫面自己的渲染需求。

3. **更正台賬既有錯誤紀錄**:`docs/quality-map.md`〈優化機會〉原寫「app-shell(main.ts)埋著倒數/暫停/重玩狀態機」——經讀碼確認**該狀態機實際在 highway.ts,main.ts 完全不含**。台賬已同步更正,原 app-shell 優化條目改指向本 ADR。

## 為何記錄

兩個模組都是 IC(重要且複雜、難以單元測試),長期靠人力細讀監管;若不記下拆分理由,下次審查者會重新面對同一坨 1100+/600 行原始碼、無從得知「哪些部分其實已經想清楚可以抽」。此外台賬的錯誤記載若不修正,會誤導下次監管把心力錯放到 main.ts 找一個根本不存在的狀態機。

- **geometry.ts / hud.ts**:純數學與純視圖殼,改版面或改飛行曲線幾何互不影響對方,是最沒有爭議的切分,原本就已在台賬〈優化機會〉記錄。
- **highwayState.ts(新)**:程式內註解顯示這段轉移規則的變動歷史是獨立的設計決策鏈(issue 13、grilling 2026-07-12 的分頁切背景自動暫停、尾段全判定完直接結束等規則),與幾何數學、DOM 外觀的變動原因完全不同,是「必然一起隨業務變動」判準下該切開的一塊。抽成純函式後才可能像 `judge.ts` 一樣被 fixture 直接單元測試釘住,而不必靠 playtest-highway 才能驗證這段邏輯的正確性。
- **main.ts 的快取歸屬**:此為需要使用者裁決之處,因為畫面元件各自持有快取(單畫面即可獨立測試,零耦合)與流程編排持有快取(避免把「跨畫面免重讀」這個流程需求外洩給畫面元件,保持畫面元件單純)兩案都能自圓其說。已與使用者確認採後者。

## 被否決 / 排除

- **main.ts 快取歸畫面元件層**:會讓 DifficultyScreen 對外暴露「已讀內容」這個流程用的中繼資料,污染畫面元件應有的單純渲染介面。已否決,見上。
- **暫緩處理 main.ts 快取耦合問題,先只拆語法上無爭議的部分**:曾列為選項,使用者選擇直接裁決快取歸屬,故不採用「延後」案。
- **321 倒數逐拍(3→2→1→完成)都各自經過 reducer 一輪**:曾考慮讓每個數字切換都送一個事件給 highwayReducer,讓倒數序列本身也被純函式釘住。否決:倒數的精確計時(`setTimeout` 0/1000/2000/3000ms)與音效時機是純粹的排程/效果實作細節,不是「該不該倒數、倒數完後去哪」這類業務決策;硬塞進 reducer 只會讓 reducer 背上計時器排程的責任,卻換不到額外的可測試性(逐拍時序本來就得留在 highway.ts 用真計時器跑,fixture 測不到)。改為 `startCountdown` effect 一次跑完整段 321,跑完才回送單一 `countdownFinished` 事件——reducer 只決定「倒數完後轉成 playing、觸發哪種 launch」,職責邊界更乾淨。

## 實作狀態

已於 the-dev anchored-coding 階段(2026-09-12)完成落地,並用 playtest-highway 在瀏覽器實跑驗證行為與重構前一致(進場倒數/暫停/繼續續播/倒數打斷/重新開始/自然播畢/尾段直接結束/判定回饋)。落地時定案的介面(本 ADR 原本留給實作階段決定的部分):

- **`highwayState.ts`**:`highwayReducer(state: HighwayState, event: HighwayEvent): { state, effects: HighwayEffect[] }` 純函式。`HighwayState = { phase, tailReached, launchKind }`——`launchKind: 'fresh' | 'resume'` 取代原本的 `pendingLaunch` 函式參考,決定倒數結束後要從 0 開始還是從凍結位置續播。`HighwayEvent` 刻意不含鍵盤/瀏覽器細節(是否 repeat、是不是 Space/Escape、`document.hidden`)——那些由 highway.ts 的事件監聽器篩過後才轉譯成抽象事件送進 reducer。`HighwayEffect` 只有 6 種(`resetForNewRun`/`startCountdown`/`cancelCountdown`/`launch`/`pause`/`finish`),321 倒數本身的計時/音效序列不逐拍經過 reducer,而是包在 `startCountdown` effect 的實作裡一次跑完,跑完才回送單一 `countdownFinished` 事件——這是刻意的取捨,見〈被否決/排除〉。
- **`highway.ts` 的 `runEffect`**:switch 對應六種 effect,結尾加窮盡性錨點(`default` 分支把 `effect` 賦值給 `never`)——`highwayReducer` 因回傳型別非 void 而天生被 TS 窮盡檢查,但 `runEffect` 回傳 void 沒有這個天然保障,需要手動錨住,否則日後新增 effect 種類卻忘了處理會被編譯器放過、靜默變成空操作(haoli-review 品質審核階段抓到的落地期疏漏,已補上)。
- **Screens ↔ 流程編排介面**:`renderLandingScreen(app, { errorMessage?, onRun(source) })`、`renderDifficultyScreen(root, { songName, groups, wpmLabel, bestLabel, initialKeyGroup, onKeyGroupChange, onPick, onBack })`。`bestLabel`/`wpmLabel` 皆為流程編排層算好的顯示就緒字串(`Map<檔名, ...>`),畫面元件不碰 scores/settings 模組,只管渲染與事件轉發。最近清單(recentBsr)與資料備份(backup)因不跨畫面共享狀態,改由 `landingScreen.ts` 直接持有其 I/O,未經流程編排層——與難度檔快取(跨畫面共用)的處理方式刻意不同,見〈決策〉第 2 點的判準。

## 連帶影響

- `docs/quality-map.md`:app-shell 優化機會條目已更正指向本 ADR;highway 的既有兩條優化機會(geometry.ts / hud.ts)可視為已被本 ADR 吸收擴充(新增 highwayState.ts 一塊)。
- highway 抽出 `highwayState.ts` 後,該模組有機會從 IC 降級評估(狀態機轉為 IS 可測、hud.ts/geometry.ts 各自可測),但**降級判定屬品質監管職責**,需等實作完成、由 quality-tiering 技能重新分類,本 ADR 不預先論斷格別。
