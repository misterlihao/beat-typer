# 03 — 同拍 burst + 內側鍵 + 弧線長按 + 特殊元素過濾

> 標籤:`ready-for-agent`(待 tracker 授權後上傳) · 來源:docs/PRD.md

## What to build

補上 `compileChart` 剩餘的攤平規則,讓輸出忠於譜面且可玩:

- **同拍展開**:同一時間點的多顆音符依序展開為極短固定間隔的 burst(一次一鍵)。
- **內側鍵**:同拍「額外」音符改映射到同側食指內側鍵,依列取上/中/下——左 T/G/B、右 Y/H/N。
- **弧線→長按**:v3 弧線(arc)轉為 `kind:'hold'` 並帶 `holdEndSec`。
- **過濾**:炸彈、牆、鏈條(chain)一律濾除,不進 chart。

## Acceptance criteria

- [ ] 同拍多音符展開為 burst,順序與間隔正確
- [ ] 同拍額外音符落到 T/G/B・Y/H/N,且依列(上中下)正確
- [ ] 弧線輸出 `kind:'hold'` 且 `holdEndSec` 正確
- [ ] 炸彈/牆/鏈條被濾除,不出現在 chart
- [ ] 文字預覽顯示每個元素的 `kind`(press/hold)與 holdEnd
- [ ] 上述皆有 fixture 測試

## Blocked by

- 02 — 完整全格映射 + v3 支援
