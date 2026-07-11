// 「最近遊玩的 BSR」持久化(issue 19 切片,grilling 2026-07-12):
// 著陸畫面列出最近成功載入過的 BeatSaver 代號(歌名 + 代號),點擊即重新下載重玩。
// 純函式 coerceRecentBsr 可測;load/record 為薄 localStorage I/O(不 mock、不測)。
// 只搬字串,不碰譜面/音訊/成績,維持 loader 薄層紀律。

const STORAGE_KEY = 'beat-typer:recent-bsr';
// 持久上限:夠涵蓋「最近想再打的幾張」又不讓 blob 無限長;顯示層自訂可視高度 + 捲軸。
const MAX_ENTRIES = 20;

/** 一筆最近 BSR:代號 + 顯示歌名(缺歌名時退回代號)。刻意不存封面/分數(見 grilling)。 */
export interface RecentBsr {
  readonly code: string;
  readonly songName: string;
}

/**
 * 把任意來源(壞 JSON / 被竄改)強制成合法清單:非陣列 → 空;逐筆丟棄壞項(缺/非字串 code);
 * 以 code 去重(保留較前 = 較新的一筆)、截到上限。歌名非字串 / 空字串時退回 code。純函式,可測。
 */
export function coerceRecentBsr(raw: unknown): RecentBsr[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentBsr[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const code = obj.code;
    if (typeof code !== 'string' || code.length === 0 || seen.has(code)) continue;
    seen.add(code);
    const name = typeof obj.songName === 'string' && obj.songName.length > 0 ? obj.songName : code;
    out.push({ code, songName: name });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/** 讀最近清單;localStorage 不可用 / 空 / 壞 JSON 一律靜默回空清單。 */
export function loadRecentBsr(): RecentBsr[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text !== null) return coerceRecentBsr(JSON.parse(text));
  } catch {
    // localStorage 不可用(隱私模式 / 停用)或 JSON 壞 → 空清單
  }
  return [];
}

/**
 * 記一筆最近 BSR:新的一筆置頂、以 code 去重(順手更新歌名)、截到上限,寫回。
 * 寫入失敗(配額 / 停用)靜默略過,不中斷載入。回傳更新後清單供呼叫端就地重繪。
 */
export function recordRecentBsr(code: string, songName: string): RecentBsr[] {
  const next = coerceRecentBsr([{ code, songName }, ...loadRecentBsr()]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 寫入失敗不該影響載入
  }
  return next;
}

/** 從最近清單移除指定 code(玩家嫌某張譜不好玩,手動刪)。寫入失敗靜默略過。回傳更新後清單。 */
export function removeRecentBsr(code: string): RecentBsr[] {
  const next = loadRecentBsr().filter((r) => r.code !== code);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 寫入失敗不該影響載入
  }
  return next;
}
