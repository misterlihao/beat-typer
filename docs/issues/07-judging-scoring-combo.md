# 07 — 判定 + 計分 + combo(judge 接縫)

> 來源:docs/PRD.md

## What to build

實作 `judge(chart, inputEvents, config) → { judgments, summary }` 純函式,並接上鍵盤事件與 3D 回饋。節奏判定:按下時間與音符 `tSec` 的差落在時間窗內近→Perfect、遠→Good、出窗→Miss。目標音符在判定窗內時敲錯鍵 → 該音符判 Miss + 斷 combo;附近無音符的多餘按鍵 → 只計入準確率統計、不斷 combo。即時顯示 combo 與判定回饋。窗寬與 offset 由 `config` 提供。(長按判定於 issue 08。)

## Acceptance criteria

- [ ] 窗內近/遠正確給 Perfect/Good;出窗給 Miss
- [ ] 窗內錯鍵 → 該音符 Miss 且 combo 歸零
- [ ] 窗外多餘按鍵 → 計入準確率但不斷 combo
- [ ] 遊玩時即時顯示 combo 與每次判定的視覺回饋
- [ ] `judge` 為純函式,以「chart + 帶時戳按鍵事件」fixtures 驗證上述規則

## Blocked by

- 06 — 3D 高速公路 + 音符飛行 + billboard + 音同步
