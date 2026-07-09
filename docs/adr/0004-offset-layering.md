# 譜面 offset 烘進 chart,使用者校準 offset 留在時鐘層

**Status:** accepted

`compileChart` 把 `tSec` 算為 `beat * 60 / BPM + _songTimeOffset`——譜面自帶的 `_songTimeOffset` 在編譯期烘進音符時間。使用者校準 offset(補償本機音訊/顯示延遲)**不**進 TypingChart,而在播放時鐘與 judge 層才套用。

## 為何記錄

一個直覺做法是把所有 offset 都算進音符時間;我們刻意把兩種 offset 拆到不同層,理由不直觀。

## 關鍵推理

- `_songTimeOffset` 是**譜面的固有屬性**、可決定性,屬編譯階段。烘進去後 TypingChart 的 `tSec` 就是「相對音訊起點的純秒數」。
- 使用者校準 offset 是**每台機器不同**的執行期補償。若烘進 chart:fixture 測試會依賴機器設定、換機須重編譯、chart 不再跨機器位元相同。留在時鐘層則 TypingChart 保持可攜、可決定性,校準只在播放/判定當下疊加。
- 慣例:`_songTimeOffset` 正值把音符往後推(相加)。
