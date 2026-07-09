# zip 來源的 readFile 採「大小寫不敏感 + basename 比對」

**Status:** accepted

`ZipChartSource` 的 `SongHandle.readFile(name)` 查找 zip entry 時:把每個 entry 的 **basename**(去路徑)轉小寫,建成「小寫 basename → entry」對照表;呼叫端傳裸檔名(`Info.dat` / 難度檔 / `song.egg`),同樣轉小寫 basename 後查表。撞名(不同子夾出現同 basename)時取第一個命中並 `console.warn`。

## 為何記錄

直覺做法是照 `SongHandle` 契約字面「大小寫寬容」只做大小寫不敏感、保留完整路徑精確比對。我們刻意連 **路徑** 也忽略(只比 basename),這一步日後很容易被當成多餘而「簡化」回精確路徑比對,然後在真實 zip 上壞掉——與 ADR 0005 同類的「不留痕就會被還原」決定。

## 關鍵推理

- 真實 BeatSaver zip 有兩種與遊戲邏輯無關的雜訊:**大小寫**(`Info.dat` vs `info.dat`)與**巢狀子夾**(檔案包在 `SongName/…` 內)。orchestrator 只知道裸檔名(`readFile('Info.dat')`),不該去猜路徑或大小寫。
- basename + 小寫比對一次吃掉兩種雜訊,讓 loader 維持「只搬 bytes、對來源結構無感」(ADR 0005),compileChart / orchestrator 零改動。
- 參考標準檔 `pale.zip`:全檔在根層、`Info.dat` 精確大小寫——此規則對它退化為精確比對,零風險;規則只在遇到髒 zip 時才發揮韌性。

## 連帶約束

- 撞名風險(同 basename 出現在不同子夾)在 BeatSaver 譜面包實質不發生;採「第一個命中 + `console.warn`」而非報錯,避免把罕見情況變成載入失敗。
- 內建來源(ADR 0005 提到 01 把寬容延到 04/05)本就自控檔名,不受影響。
