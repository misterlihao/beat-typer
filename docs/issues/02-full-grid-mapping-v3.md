# 02 — 完整全格映射 + v3 支援

> 標籤:`ready-for-agent`(待 tracker 授權後上傳) · 來源:docs/PRD.md

## What to build

把 `compileChart` 的映射補齊到完整、正確,並支援 v3 格式。顏色→左右手、欄→手指、列→鍵盤上中下排,唯一對應到映射表的每一格;右手需做「欄鏡射」(Beat Saber 最左欄對右手食指、最右欄對右手小指)。v2 與 v3 兩種格式都要正規化後走同一條映射邏輯。beat→秒換算需涵蓋含 offset 的情境。

映射表(全格,唯一對應):

| 手指(欄) | 上排(layer2) | 家排(layer1) | 下排(layer0) |
|---|---|---|---|
| 左小指(col0) | Q | A | Z |
| 左無名(col1) | W | S | X |
| 左中指(col2) | E | D | C |
| 左食指(col3) | R | F | V |
| 右食指(col0) | U | J | M |
| 右中指(col1) | I | K | , |
| 右無名(col2) | O | L | . |
| 右小指(col3) | P | ; | / |

(內側 burst 鍵 T/G/B・Y/H/N 於 issue 03 處理。)

## Acceptance criteria

- [ ] v2 與 v3 fixtures 都能解析並產出一致的 `TypingChart`
- [ ] 映射表每一格都有 fixture 驗證(顏色/欄/列 → 正確字母)
- [ ] 右手欄鏡射正確
- [ ] beat→秒換算在含 `_songTimeOffset` / 不同 BPM 下正確
- [ ] 文字預覽能顯示每個音符的 hand/finger/row 中繼資訊以利驗證

## Blocked by

- 01 — 專案骨架 + 端到端 tracer bullet
