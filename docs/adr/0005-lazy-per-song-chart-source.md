# loader 接縫採「惰性、每首歌」的 ChartSource / SongHandle

**Status:** accepted

loader 層的抽象是 `ChartSource.listSongs() → SongHandle[]`,每個 `SongHandle` 提供惰性的 `readFile(name)`(單檔、大小寫寬容)。搭配純函式 `parseInfo(infoText) → { bpm, songTimeOffset, audioFilename, difficulties }`,讓編排層先讀 Info.dat、顯示難度選單、再只讀選定難度檔與音訊。`compileChart` 仍接收單首歌的原始檔案、源頭無關。

## 為何記錄

直覺做法是 loader 一次回傳「所有檔案的 bytes」。我們刻意改成惰性、每首歌,理由與未來的本地資料夾載入強相關,現在不留痕日後會被「簡化」回一次全抓。

## 關鍵推理

- CustomLevels 資料夾(issue 05)含**數百首歌**、每首音訊數 MB。一次全抓會在使用者選歌前 slurp 整個資料夾,不可行。
- 內建(01)、zip(04)、資料夾(05)三種來源只是 `ChartSource` 的不同實作;compileChart 零改動。
- `parseInfo` 抽成純函式:難度選單本來就需要它,且讓 compileChart 不碰 I/O 即可保持純函式(read Info.dat 這步在編排層,不在 compileChart 內)。

## 連帶約束

- issue 01 只實作內建 source(`listSongs` 回 1 首、`readFile` = fetch),但介面形狀一次到位,04/05 只需新增 source 實作。
