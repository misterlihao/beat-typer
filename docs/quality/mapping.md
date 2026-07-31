# 契約摘要:mapping(鍵盤位置來源表)

對應原始檔:`src/compile/mapping.ts`
另參考:CONTEXT.md「映射 / 手 / 內側鍵 / 字形」、docs/adr/0003、0006。
**真實來源以 code + docs/ 為準,本檔僅快讀投影。**

---

## 職責

純查表:描述「鍵盤上哪個位置是哪個實體鍵」,以及「按鍵碼給玩家看的字形」。**只是位置字典,不含遊戲邏輯**。

**明確不做的事**:不決定某顆音符「該對到哪個鍵」——那是鍵指派(`keyAssignment.ts`、docs/adr/0008)的事。key→高速公路道的對應在 highway 層(`KEY_LAYOUT`),也不在此。

## 位置語義(唯一保留的空間語義)

**手由顏色決定**(紅=左、藍=右),是映射中唯一保留的 Beat Saber 位置語義。手指與排(即最終落哪個鍵)**不**由欄/列推導,而交給鍵指派為打字練習平衡選出。因此本表以 `(hand, finger, bank)` 為索引,不以欄/列為索引。

## 公開介面

```ts
function keyFor(hand: Hand, finger: Finger, bank: Bank): string   // → KeyboardEvent.code
function innerKeyFor(hand: Hand, bank: Bank): string              // 內側鍵一律屬食指
function glyphOf(code: string): string                            // 按鍵碼 → 顯示字元

type Hand   = 'left' | 'right';
type Finger = 'pinky' | 'ring' | 'middle' | 'index';
type Bank   = 'number' | 'top' | 'home' | 'bottom';
```

回傳值一律為 `KeyboardEvent.code`(如 `"KeyF"`、`"Semicolon"`),**不是字元**(見 docs/adr/0003)。

## 鍵池契約

**主鍵盤(8 指 × 4 排 = 32 鍵)**,`keyFor`:

| | pinky | ring | middle | index |
|---|---|---|---|---|
| **left** number | 1 | 2 | 3 | 4 |
| left top | Q | W | E | R |
| left home | A | S | D | F |
| left bottom | Z | X | C | V |
| **right** number | 0 | 9 | 8 | 7 |
| right top | P | O | I | U |
| right home | ; (Semicolon) | L | K | J |
| right bottom | / (Slash) | . (Period) | , (Comma) | M |

(右手在表中順序為 index/middle/ring/pinky;上表已按左右手對稱重排,值以 code 表示;數字鍵的 code 為 `Digit1`…`Digit0`。)

**內側鍵(2 食指內側 × 4 排 = 8 鍵)**,`innerKeyFor`——一律歸屬食指:

| | number | top | home | bottom |
|---|---|---|---|---|
| left | 5 | T | G | B |
| right | 6 | Y | H | N |

內側鍵是食指內側 reach 的四個列。`keyAssignment`(docs/adr/0008)把它們併進該手的**加權鍵池**、帶 `INNER_PENALTY`(0.5)折扣,任何音符都可能被指派到——**不保留給特殊用途**。主鍵池 32 + 內側 8 = 每手 20 鍵(全鍵鍵池大小的來源)。

**數字排**沒有對應的 Beat Saber 列(本體只有三列),是純為打字練習加的第四排;它只從教學權重(最低)與 `number` 鍵群進入譜面。見 docs/adr/0011。

> ⚠ 歷史遺留:ADR 0006 舊設計曾把「同手疊放收斂後的音符」特地落到內側鍵當強調。ADR 0008 大改後此關聯已不存在——`collapseStacks`(compileChart)收斂後只吐一顆普通 press 音符交給平衡器,內側鍵純粹是鍵池成員。ADR 0006 內文(尤其結尾「收斂後 finger 記為 index」)就此點亦已過時。

## glyphOf(顯示投影)

- `code.startsWith('Key')` → 去掉 `"Key"` 前綴(`"KeyF"` → `"F"`)。
- `code.startsWith('Digit')` → 去掉 `"Digit"` 前綴(`"Digit1"` → `"1"`)。
- 符號鍵查表:`Semicolon`→`;`、`Comma`→`,`、`Period`→`.`、`Slash`→`/`。
- 其他未知碼 → 原樣回傳。

純顯示投影,**不存進 Note**(字形永遠由 `glyphOf(code)` 即時推導)。

## 不變式

- 三個函式皆為純查表,無 I/O、無副作用、對同輸入永得同輸出。
- `(hand, finger, bank)` 全組合都有對應鍵(表為全格,無缺格)。
- 主鍵、內側鍵、各手之間按鍵碼互不重疊(40 個 code 唯一)。
