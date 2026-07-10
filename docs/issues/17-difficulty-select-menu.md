# 17 — 難度選擇畫面(全來源)

> 來源:issue 05 拆分(2026-07-11,grill-with-docs)。原 issue 05 綁「CustomLevels 資料夾來源 + 難度選單」;
> 難度選單惠及所有來源、小且可自動驗,先獨立做;資料夾來源(Chromium-only、需手動實跑)留 issue 05。

## 問題

所有載入路徑(內建 / zip / BSR)目前都被 `pickPlayableDifficulty` 自動鎖定單一難度([main.ts](../../src/main.ts))。
玩家無法選 Easy/Normal/Hard/Expert/ExpertPlus,也看不到各難度資訊。

## What to build

載入譜面後、進高速公路前,插一個**難度選擇畫面**;選定後才 `compileChart` → 掛載高速公路。

### 定案(grill 收斂)

1. **流程**:`bootstrap`(讀 Info.dat + parseInfo)→ **難度選擇畫面** → 選定 → `compileChart` → mountViews。
   多首來源(資料夾,issue 05)日後在此畫面前再加一層選歌,落點一致。
2. **清單呈現**:
   - **濾掉 Lightshow**(純燈光、無音符)。
   - 難度按**標準序** Easy→Normal→Hard→Expert→ExpertPlus(非檔案序);未知難度排最後。
   - **多 characteristic 才分組**顯示(Standard 優先);單一特性不顯示分組標題。
   - 每顆按鈕顯示**難度名 + NPS**。
   - 一律顯示選單(即使只有一個難度)。
3. **NPS(粗估,精度不重要)**:`NPS ≈ 音符數 ÷ (最後一顆音符 beat × 60 / BPM)`,常數 BPM 近似(**忽略變速、不解碼音訊**),只用 parseInfo 已有的 `bpm`。純函式 `noteStats(diffText) → {count, lastBeat}`(v3 數 `colorNotes`;v2 數 `_notes` 濾炸彈 `_type 3`)。無音符 → 不顯示 NPS。
4. **預讀**:為算各難度 NPS,開選單前**讀齊所有可玩難度檔**(單首歌幾個檔,可接受),快取文字供選定後 compile 重用(不重讀)。
5. **返回**:難度畫面左上「← 返回」回著陸畫面(重選來源)。進高速公路後維持現狀(無返回,換歌重整)。

### 純函式接縫(寫 fixtures)

- `buildDifficultyMenu(difficulties) → DifficultyGroup[]`:濾 Lightshow + 分組 + 標準序(Standard 組優先)。
- `noteStats(diffText) → {count, lastBeat}`:v2/v3 音符數與末拍。
- NPS 算術與畫面渲染為 I/O/薄層,靠 playtest 驗。

## Acceptance criteria

- [ ] 載入任一來源(內建/zip/BSR)後顯示難度選擇畫面,列出可玩難度
- [ ] 難度按標準序;Lightshow 不出現;多 characteristic 才分組(Standard 優先)
- [ ] 每個難度顯示 NPS 粗估;選定後進高速公路玩該難度
- [ ] `buildDifficultyMenu`、`noteStats` 有 vitest fixtures
- [ ] 「← 返回」回著陸畫面;錯誤(缺難度檔/音訊解不開)沿用既有紅字路徑
- [ ] compileChart / judge 純函式不變;選單/畫面為薄層

## Out of scope

- CustomLevels 資料夾來源與選歌畫面(issue 05)。
- 精確 NPS(變速加權 / 音訊實際長度)。
- 難度檔的音符數以外的 metadata(星等、mapper…)。
- 高速公路內即時換難度(選單只在進場前)。
