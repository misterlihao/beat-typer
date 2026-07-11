# 長按判定:一個判定單位、兩道閘門(頭部即時 + 放開)

**Status:** accepted

長按(hold)在 `judge` 中是**一個判定單位**(`results[i]` 與音符維持 1:1),經**兩道閘門**定案:**頭部閘門**在 `tSec` 沿用 `perfectSec/goodSec` 窗,keydown 按對鍵當場給 Perfect/Good、+1 combo、即時回饋(與一般 press 完全一致);**放開閘門**以**破壞點 = `holdEndSec − goodSec`** 為唯一界線——早於此點放開判 Miss(斷 combo),撐過此點即鎖定並維持頭部結果。`InputEvent` 新增可選 `up?`,`Judger` 新增 `release()` 原語(與 `press`/`expiry` 並列的單一真相來源)。

## 為何記錄

三點違反直覺、且動到次接縫(judge)的核心契約與共用增量引擎,不可輕易反轉:

1. **一顆長按只佔一份**(非頭、尾各一份):準確率分母仍 = 音符數、combo +1、summary 不動。代價是頭部命中須先「暫記」而非立刻寫入 `results[i]`——見下。
2. **頭部即時給分、放開只能維持或打破**:玩家在頭部就拿到 Perfect/Good 與 combo(手感即時);提早放開時 combo 在**放開的當下時刻**才斷(可能晚於頭部,貼近節奏遊戲),`maxCombo` 保留曾達到的峰值。
3. **尾部只有一條門檻**:重用既有 `goodSec` 當破壞點容差,不新增 config 旋鈕;「按住超過尾部」自然免罰,不必定義上緣窗。

## 關鍵推理

- **頭部命中期間 `results[i]` 維持 null**:否則即時渲染會用 `resultAt(i)` 立刻把音符收起,但玩家其實還按著。長按改進「持續中(active hold)」狀態暫存頭部結果,直到鎖定或破才寫入 `results[i]`、收起長條。這是 `Judger` 契約的關鍵細節:一顆已「頭部命中」的長按,`resultAt` 仍回 null。
- **`expiry(now)` 擴充雙職**:對未命中的頭部照舊補 Miss(與 press 同路徑);對持續中的長按,在 `now ≥ holdEndSec` 自動鎖定命中(涵蓋「從不放開」)。批次與即時共用此原語。
- **批次 `judge()`** 依 `t` 排序混合 down/up 事件,`e.up` 分派 `release()`;07 既有 fixtures(全無 `up`)不受影響。
- determinism / 純函式不變:無 I/O、無 RNG,相同事件序列得相同判定。

## 被否決 / 排除

- **兩個獨立判定單位(頭、尾各一)**:貼近 Beat Saber、不需 combo「當下才斷」的時序,但一顆長按在準確率/combo 佔兩份,且要拆 `results` 索引(現為 note↔result 1:1),動到 07 核心結構。不划算。
- **獨立的 `releaseSec` 尾部窗**:多一個要調的旋鈕;`goodSec` 已足夠且與頭部一致。
- **中途補抓長按**(錯過頭部窗後仍可接住):與 press 的窗語義不一致、難測。錯過頭部即整顆 Miss。
- **提早放開降級成 Good**(而非 Miss):曾考慮,選擇 Miss——「沒撐住 = 沒打中」語義更清楚。

## 連帶影響

- 短長按(`holdEndSec − goodSec ≤ tSec`)自然退化成「按下即鎖定」= 等於 press,不特別處理。
- compile 穩健性:v3 弧線 `holdEndSec ≤ tSec`(壞資料)直接當 `kind:'press'`,防 3D 反向長條;非判定規則。
- 尾部完成音沿用 `playTick('high')`(對齊鎖定時機,不綁物理 keyup);破不響。
- 3D:按住期間目標格持續發光(新增不衰減模式)+ 長條提亮;鎖定金脈衝、破紅閃。
