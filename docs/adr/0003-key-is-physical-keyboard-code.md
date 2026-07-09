# TypingChart 的 `key` 存實體按鍵碼,不存字元

**Status:** accepted

`Note.key` 存 `KeyboardEvent.code`(如 `"KeyF"`、`"Semicolon"`、`"Comma"`),而非顯示字元(`"f"`、`";"`)。給玩家看的字形一律由 `glyphOf(code)` 即時推導,不在 Note 上冗餘儲存。

## 為何記錄

`key: string` 的字串內容有兩種合理解讀(碼 vs 字元),選錯會在 judge(issue 07)才爆出比對問題,且形狀被 preview/render/judge 三層消費,難改。

## 關鍵推理

- 本作是**觸控打字指法**練習,本質是**實體鍵位**而非字元:同一實體位置在任何 OS 佈局下都是同一根手指。`event.code` 精準表達實體位置,佈局無關。
- judge 用 `event.code` 比對最穩;`event.key` 受 Shift 與佈局影響(`;`↔`:`、大小寫、符號鍵尤甚)。
- 顯示是投影而非身分,故 glyph 即時推導、單一真相來源、不冗餘。

## 連帶約束

- 映射表的「字母」預設玩家使用 **QWERTY 實體佈局**;非 QWERTY 佈局者手指分區正確,但看到的字母可能與其 OS 實際打出的字元不同(對指法練習無妨)。
