# 09 — 結算畫面 + 評級 + 重玩

> 標籤:`ready-for-agent`(待 tracker 授權後上傳) · 來源:docs/PRD.md

## What to build

歌曲一律玩到底(無血條、不會 game over)。結束後顯示結算畫面:準確率%、最大 combo、Perfect/Good/Miss 各自數量、總評級(如 S/A/B)。提供「重玩同一張同難度」按鈕。評級由 `judge` 的 `summary` 計算。

## Acceptance criteria

- [ ] 打太爛也不會中斷,一定播到整首結束
- [ ] 結算顯示準確率%、最大 combo、各判定計數、總評級
- [ ] 評級門檻明確且由 `summary` 計算(有測試)
- [ ] 「重玩」可用相同譜面與難度立即再來一次

## Blocked by

- 07 — 判定 + 計分 + combo(judge 接縫)
