# 譜面燈光(compileLightShow)測試案例摘要

- 對應 code:`src/compile/lightShow.ts`
- 對應測試:`src/compile/__tests__/lightShow.test.ts`
- **真實來源以測試 code 為準,本檔僅快讀投影。** 用途:判斷「測試覆蓋夠不夠」,不是逆推正確性(正確性交給測試跑綠把關)。

## 這是什麼

`compileLightShow(rawMapFiles, difficultyId)` 把 Beat Saber 譜面的燈光事件編譯成一條標準化、依 `tSec` 排序的 `LightShow`(每筆 = 時刻 / 燈組 / 動作 / 顏色 / 亮度)。純函式,無 I/O。燈光與 TypingChart 正交,不影響音符 / 判定 / 計分。

## 逐條:每組測試在驗什麼行為

### 輸入選擇:有沒有讀到「正確的那一個難度檔」
與燈光語意無關的上游一步。`compileLightShow` 拿到的是「整張圖的檔案集 + 一個難度身分」,得先把身分解析成檔名、取出該檔,才有燈光可解析。這組測試釘的就是這一步。

- **難度身分對不上 → 空時間線**:身分 = 特性 + 難度名;同資料換掉難度名(`Standard Nope`)即空。反面對照組是同一份資料用正確身分會有 1 筆輸出。
- **缺該難度檔 → 空時間線**:`difficultyFiles` 沒有身分解析出的那個檔名時退化為空。

- **燈光取身分吻合的那個檔,不被排前面的同名難度搶走**(GitHub issue #4 回歸點)
  - **fixture**:Info.dat 兩個特性各有一個 `ExpertPlus`(`Lightshow` 排在 `Standard` **前面**);`difficultyFiles` 只放 `ep-standard.dat`(模擬編排層惰性載入——只讀使用者選中的那一個檔)。該檔內有 1 筆 beat 2 的燈光事件。
  - **斷言**:輸出**恰 1 筆**、`tSec ≈ 1`(beat 2 @120bpm)。
  - **釘住的行為**:兩件本模組特有的事 ——(1) `compileLightShow` **沒漏接**身分比對:它與 `compileChart` 各自查一次,只改一邊不會被對方的測試抓到;(2) 這條錯誤路徑是**靜默**的。身分比對規則本身不在這裡測,在 `parseInfo.test.ts`(規則的家)。
  - **為什麼要在這裡再測一次**:若身分解析錯,會拿到 `ep-lightshow.dat`,該檔不在 `difficultyFiles` → 落「缺該難度檔」分支 → 回 `[]`。**而空時間線是合法輸出**(沒有燈光的圖本來就是空),所以不丟錯、畫面無紅字,只是 Standard 譜的燈光整條無聲消失。這是本模組唯一「壞掉但沒人會發現」的路徑,故本模組其他退化條目都斷言「等於 `[]`」,**唯獨這條反過來斷言「不等於空」**。

### 格式解析
- **解析 v2 `_events`**:讀出 `_type`→group、`_value`→action、`_time`→`tSec`(beat 換秒)。
- **解析 v3 `basicBeatmapEvents`**:讀 `b`/`et`/`i` 欄位;beat 2 @120bpm → 1 秒。
- **無事件 / 空陣列 / 不支援版本 / 壞 JSON → 空時間線**:燈光為選配,一律優雅退化回 `[]`,不丟錯。

### 動作解碼(decodeValue)
- **值 → off/on/flash/fade/transition**:逐一驗 0=off;1/5=on;2/6=flash;3/7=fade;4/8/12=transition,涵蓋藍碼(1-4)、紅碼(5-8)、白碼(12)。
- **transition 保留亮度、不歸零**(近期 bug 回歸點):4/8/12 是「漸變到目標」,亮度為目標值(f=0→0、f=1→1),交由 sink 做 lerp;不像 off 直接歸零。此案例守住「transition 被誤當瞬間亮 → 整組頻閃」的回歸。
- **顏色側:1~4=藍、5~8=紅、9~12=白**:特別驗 `8=紅 transition`(近期「紅 trans 誤判為白」的回歸點),及 `4=藍 transition`。
- **brightness = floatValue × Chroma alpha,夾 [0,2]**:float 0.5 → 0.5;Chroma alpha 3(HDR)× float 1 → 夾到上限 2。

### 色燈組計數(排除旋轉 / 轉速)
- **排除 et 5/8/9/12/13 等**:色 boost / 環旋轉 / 雷射轉速等「非顏色燈」事件被過濾,只留色燈組(輸出的 group 集合僅剩色燈組 id)。

### 顏色鏈(Chroma > env 覆寫 > 預設)
- **無指定 → 預設淡紅藍**:紅碼偏紅、藍碼偏藍。
- **env 覆寫優先於預設**:Info `_customData._envColorLeft/Right` 存在時取之(即使被改成綠也照取)。
- **逐事件 Chroma 凌駕 env 與預設**:事件自帶 `_color` 時最優先。
- **v3 Chroma 用 `customData.color`**:v3 欄位名對照正確。

### 時間對齊
- **tSec 含 songTimeOffset**:落點加上 Info 的偏移。
- **v3 變速(bpmEvents)影響落點**:多段 BPM 時 beat→秒用同源 bpmTimeline 正確累積。
- **依 tSec 遞增排序**:亂序輸入 → 輸出按時間非遞減。

### lightID 收斂
- **同時刻同組多筆只留最後一筆**:Chroma `_lightID` 對單顆燈的展開,sink 一組只有一個發光體,故收斂取最後一筆的顏色 / 動作。

## 覆蓋缺口候選(供判斷是否補測)

- **`fade`(3/7/11)與 white on/flash(9/10/11)未被顏色 / 亮度斷言**:動作表只點名 fade 的 action label,未驗其顏色側 slot,white slot(9-11)也只在解碼註解出現、未有斷言。
- **未知 / 越界值(如 13、負數、>12)落 action 分支**:code 註記「未知當 on」且 slot 白色兜底,但無測試釘住此行為。
- **env 只覆寫單一 slot(如只給 left,right 落預設)** 未被單獨驗;現有 env 測試多同時給或只測被覆寫那側。
- **`_envColorWhite` / v3 白色 env 覆寫**:code 有 `white` 分支,測試未觸及。
- **Chroma `_color` 越界值夾 [0,1]**(clamp01 在 readChroma)無直接斷言;負值 / >1 的 rgb 是否夾住未測。
- **v3 `customData.color` 只有 3 元素 vs 4 元素(帶 alpha)對 brightness 的影響**:v3 Chroma 測試只驗顏色、未驗其 alpha 進亮度。
- **收斂時「不同時刻」或「同時刻不同組」不被誤併**:只驗了「同時刻同組要併」,未反向驗「不同組不併」。
- **beat / value 為非數字但事件其他欄位正常時的逐筆跳過**:code 有 `typeof … !== 'number'` 守衛,無混合正常 / 壞事件的 salvage 案例。
