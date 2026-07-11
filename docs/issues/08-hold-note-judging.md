# 08 — 長按判定

> 來源:docs/PRD.md · 設計定案見 docs/adr/0010、CONTEXT「長按/持續段/破壞點/鎖定」

## What to build

替 `kind:'hold'` 音符加上長按判定,接進 `judge`(次接縫)與 3D 高速公路。玩家須在頭部判定窗內按對鍵、持續按住整個持續段、撐到尾部附近再放開才算命中;提早放開 → Miss。3D 呈現持續段與「正在按住/鎖定/破」的回饋。

## 設計定案(2026-07-11,grill-with-docs)

**判定模型(見 ADR 0010):一個判定單位、兩道閘門。**

1. **頭部閘門**(在 `tSec`,沿用 `perfectSec/goodSec` 窗):keydown 按對鍵 → 當場給 Perfect/Good、+1 combo、閃字、`playTick`(與一般 press 完全一致的即時回饋)。**但不寫 `results[i]`**——改進「持續中(active hold)」狀態暫存頭部結果,讓長條繼續飛行可見。頭部窗內錯鍵/沒按 → `expiry` 判整顆 Miss、斷 combo(與 press miss 同路徑)。
2. **放開閘門**(破壞點 = `holdEndSec − goodSec`):
   - keyup 早於破壞點 → **破**:`results[i]=miss`、combo 歸零、Miss 閃字 + 該格閃紅 + 長條收起。
   - 撐過破壞點(任何時候放、或按到底)→ **鎖定**:頭部結果寫入 `results[i]`(combo 已於頭部計入不變),尾端金色脈衝 + `playTick('high')` + 長條收起。
   - 從不放開:`expiry(now)` 在 `now ≥ holdEndSec` 自動鎖定,不懸置。

**計分/combo(沿用 07,不新增規則)**:長按與 press 同權(Perfect 1 / Good 0.5 / Miss 0),分母 = 音符數;combo 於頭部 +1,破則在放開當下斷(`maxCombo` 保留峰值);破掉的長按算 miss 使 `fullCombo=false`。

**接縫契約變更**:`InputEvent` 加可選 `up?: boolean`(缺省=按下;07 既有 fixtures 不受影響);`Judger` 新增 `release(event)` 原語,`expiry` 擴充負責 hold 自動鎖定;batch `judge()` 依 `t` 排序混合 down/up 事件,`e.up` 分派 `release()`。即時路徑高速公路加 `keyup` 監聽 → `judger.release(...)`。無對應長按的放開一律忽略。

**compile 穩健性**:v3 弧線 `holdEndSec ≤ tSec`(壞資料)→ 當 `kind:'press'`(丟壞 tail);短長按不特別處理(自然退化成按下即鎖定)。

**3D / 音效**:按住期間目標格**持續發光**(新增不衰減模式)+ 分段長條**提亮**;鎖定→金脈衝;破→紅閃 + Miss 閃字;尾部完成音用現有 `playTick('high')`,破不響。

## Acceptance criteria

- [ ] 正確按住(頭部命中 + 撐過破壞點後放開)判為命中,維持頭部的 Perfect/Good
- [ ] 提早放開(keyup < 破壞點)→ Miss、斷 combo
- [ ] 從不放開(按住到底)→ 於 `holdEndSec` 自動鎖定命中,音符正常收起
- [ ] 頭部未命中(錯鍵 / 沒按)→ 整顆 Miss(與 press miss 同路徑),之後同鍵 keyup 忽略
- [ ] 頭部判 Good 且撐住 → 鎖定仍為 Good(頭部等級被維持)
- [ ] 破壞點邊界:恰在 `holdEndSec − goodSec` 放開算撐住(含 EPS 容差)
- [ ] 多餘放開(無對應 active hold 的 keyup)被忽略、不罰
- [ ] batch `judge()` 對混合 down/up 事件依 `t` 穩定排序後正確判定
- [ ] `InputEvent` 無 `up` 的既有 07 fixtures 行為不變(向後相容)
- [ ] 3D:長按持續段可辨識;按住期間目標格持續發光、長條提亮;鎖定/破有對應回饋;尾部成功響一聲
- [ ] `judge` 的長按規則以手寫 fixtures 驗證(不 mock)
- [ ] tsc / build 乾淨;既有測試不回歸

## Blocked by

- 07 — 判定 + 計分 + combo(judge 接縫)
- 03 — 同拍 burst + 內側鍵 + 弧線長按 + 特殊元素過濾
