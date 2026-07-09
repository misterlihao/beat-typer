# 01 — 專案骨架 + 端到端 tracer bullet

> 來源:docs/PRD.md

## What to build

建立專案地基並打通第一條最薄的端到端穿透線。從「內建範例譜面」一路走到「可驗證的輸出」:載入內建範例 → 最小 `compileChart`(僅處理 v2 基本紅/藍音符,依全格映射取主鍵,暫不含 burst/hold/鏡射邊界) → 文字/表格預覽把攤平後的「按鍵序列 + 時間點」印出來 → 用 Web Audio 播放範例音訊。

技術地基一併建立:Vite + TypeScript + Three.js 相依、Vitest 測試框架、模組邊界(loader / compileChart / preview / audio 的空殼分層)、一首小的內建範例譜面(含 info.dat、一個 v2 難度檔、song.egg)。

`TypingChart` 元素形狀:`{ tSec: number, key: string, kind: 'press' | 'hold', holdEndSec?: number }`(外加渲染用中繼欄位如 hand/finger/row)。

## Acceptance criteria

- [ ] `npm run dev` 開啟頁面,自動載入內建範例並顯示按鍵序列 + 時間點表格
- [ ] 頁面能播放範例音訊(Web Audio `decodeAudioData` 解碼 OGG)
- [ ] `compileChart` 對 v2 基本音符輸出正確的 `TypingChart`(時間依 BPM + `_songTimeOffset` 換算)
- [ ] `npm test` 可執行,且含至少一個 `compileChart` 的 fixture 測試
- [ ] 專案分層清楚:I/O、compileChart、preview、audio 各自獨立,compileChart 為純函式

## Blocked by

- None - can start immediately
