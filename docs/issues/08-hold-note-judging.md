# 08 — 長按判定

> 標籤:`ready-for-agent`(待 tracker 授權後上傳) · 來源:docs/PRD.md

## What to build

替 `kind:'hold'` 音符加上長按判定,接進 `judge` 與 3D 視覺。玩家需在頭部判定窗內按下、持續按住至 `holdEndSec` 附近再放開才算完整命中;提早放開或未按住 → 依規則降級或 Miss。3D 呈現長按音符的「持續段」與按住/放開回饋。

## Acceptance criteria

- [ ] 正確按住(頭部命中 + 撐到尾部附近放開)判為命中
- [ ] 提早放開或未持續按住 → 降級或 Miss
- [ ] 長按音符在 3D 中以可辨識的持續段呈現,按住時有回饋
- [ ] `judge` 的長按規則以 fixtures 驗證

## Blocked by

- 07 — 判定 + 計分 + combo(judge 接縫)
- 03 — 同拍 burst + 內側鍵 + 弧線長按 + 特殊元素過濾
