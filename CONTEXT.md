# Beat Typer

把 Beat Saber 譜面轉成 3D 節奏打字練習:每顆音符依「顏色/欄/列」唯一對應到一個鍵盤字母,玩家在「長得像鍵盤」的高速公路上敲字。本檔是詞彙表,只定義概念,不含實作細節。

## Beat Saber 譜面座標(輸入端詞彙)

**欄 (Column)**:
音符的水平位置,`0~3`,玩家視角由左到右(col0 最左、col3 最右)。v2 `_lineIndex` / v3 `x`。
_Avoid_: lineIndex(那是原始欄位名,對外一律講「欄」)

**列 (Row)**:
音符的垂直位置,`0~2`,由下到上(row0 下、row1 中、row2 上)。v2 `_lineLayer` / v3 `y`。
_Avoid_: layer, lineLayer

**顏色 (Color)**:
音符的紅/藍屬性,決定由哪隻手負責:紅=左手、藍=右手。v2 `_type` / v3 `c`。
_Avoid_: type, cutDirection(切法方向本作不使用)

## 映射(核心概念)

**映射 (Mapping)**:
把一顆音符的(顏色, 欄, 列)唯一決定成一個鍵盤鍵的規則。顏色→手、欄→手指、列→鍵盤上中下排。同一個(顏色,欄,列)永遠得到同一個鍵。

**手 (Hand)**:
左或右,由顏色決定。

**手指 (Finger)**:
一隻手的小指/無名/中指/食指之一,由欄決定。**空間順序保留**:同一手內,欄由左到右對應該手手指由左到右(故兩手食指都在內側:左手 col3、右手 col0)。

**排 (Bank)**:
鍵盤的上排/家排/下排,由列決定(row2→上、row1→家、row0→下)。

**內側鍵 (Inner Key)**:
兩食指內側的保留鍵(左 T/G/B、右 Y/H/N),供同拍額外音符使用,平時不參與主映射。

## 載入(輸入端接縫)

**ChartSource**:
一個譜面來源(內建 / zip / CustomLevels 資料夾),能 `listSongs()` 列出其中的歌。三種來源共用此介面,compileChart 對來源無感。

**SongHandle**:
單一首歌,提供惰性的 `readFile(name)`(單檔讀取、檔名大小寫寬容)。選定歌/難度後才讀對應檔與音訊。

**parseInfo**:
把 Info.dat 文字淺解析成 `{ bpm, songTimeOffset, audioFilename, difficulties }` 的純函式。供難度選單與 compileChart 共用,使讀檔(I/O)留在編排層。

**RawMapFiles**:
交給 compileChart 的單首歌原始檔案(檔名→未解析文字);compileChart 自己 parse 與正規化,是唯一正規化點。

## 攤平後的輸出

**TypingChart**:
`compileChart` 的輸出;一條有序的、一次一鍵的按鍵時間軸。是渲染與判定共同消費的唯一資料來源。
_Avoid_: keymap, sequence

**音符 (Note)**:
TypingChart 的一個元素:`{ tSec, key, kind }`(外加渲染中繼:hand/finger/bank)。`key` 存**實體按鍵碼**(`KeyboardEvent.code`,如 `"KeyF"`、`"Semicolon"`),不是字元;`kind` 為 `press` 或 `hold`(hold 帶 `holdEndSec`)。
_Avoid_: event, keystroke

**字形 (Glyph)**:
一個 `key`(按鍵碼)給玩家看的顯示字元(`"Semicolon"`→`;`)。永遠由 `glyphOf(code)` 即時推導,不存進 Note。

**compileChart**:
把原始譜面檔 + 難度 + config 轉成 TypingChart 的純函式。可決定性,不含 I/O、音訊或渲染。主測試接縫。

## 遊玩(輸出端詞彙)

**高速公路 (Highway)**:
3D 遊玩畫面;音符朝判定平面飛來。左手音符在左、右手在右。

**道 (Lane)**:
高速公路上一條垂直軌;**一根手指一道**,道的左右順序照鍵盤排,使音符在畫面上的位置=該鍵在鍵盤上的位置。

**判定平面 (Judgment Plane)**:
音符抵達、玩家該敲鍵的那一刻的平面。

**judge**:
把 TypingChart + 帶時戳按鍵事件 + config 轉成判定與 summary(準確率/combo/評級)的純函式。次測試接縫。
