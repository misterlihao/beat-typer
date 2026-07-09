# 03 — 同拍 burst + 內側鍵 + 弧線長按 + 特殊元素過濾

> 來源:docs/PRD.md

## What to build

補上 `compileChart` 剩餘的攤平規則,讓輸出忠於譜面且可玩。
**注意**:經 grilling 收斂,同拍處理已由 PRD 原案「burst 展開」改為「疊放收斂」,見 docs/adr/0006。

- **疊放收斂**:同一手、相距 < 1/8 beat 的多顆音符(錨點制成群)整組收斂成**一顆內側鍵音符**(左 T/G/B、右 Y/H/N),列取錨點那顆的列。相距 ≥ 1/8 beat 的連打各自保留正常映射;跨手同拍各自保留、共用時間。
- **弧線→長按**:v3 弧線(`sliders`)轉為 `kind:'hold'` 並帶 `holdEndSec`(head→tail);與 head/tail 精確重疊的 colorNote 濾除以免 press+hold 並存。v2 弧線 v1 不支援。
- **過濾**:炸彈(v3 `bombNotes` / v2 `_type=3`)、牆(`obstacles`/`_obstacles`)、鏈條(v3 `burstSliders`)一律不進 chart(不讀即濾;鏈條 head 的 colorNote 仍當普通 press,不展開)。

## Acceptance criteria

- [ ] 同手疊放(< 1/8 beat)收斂成單一內側鍵音符,列取錨點,錨點制不鏈式串接
- [ ] 同手連打(≥ 1/8 beat)與跨手同拍各自保留
- [ ] 弧線輸出 `kind:'hold'` 且 `holdEndSec` 正確;head/tail 重疊的 colorNote 被濾除
- [ ] 炸彈/牆/鏈條被濾除,不出現在 chart
- [ ] 文字預覽顯示每個元素的 `kind`(press/hold)與 holdEnd
- [ ] 上述皆有 fixture 測試

## Blocked by

- 02 — 完整全格映射 + v3 支援
