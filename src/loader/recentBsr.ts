// 「最近遊玩的 BSR」持久化(issue 19 切片,grilling 2026-07-12 / 釘選改版 2026-07-13):
// 著陸畫面列出最近成功載入過的 BeatSaver 代號(歌名 + 代號),點擊即重新下載重玩。
// 可釘選:釘選項目置頂、順序凍結、永不被上限淘汰;未釘選最新在上、超量時最舊者被淘汰。
// 純函式 coerceRecentBsr 可測;load/record/toggle 為薄 localStorage I/O(不 mock、不測)。
// 只搬字串,不碰譜面/音訊/成績,維持 loader 薄層紀律。

const STORAGE_KEY = 'beat-typer:recent-bsr';
// 持久上限(釘選 + 未釘選 總數):夠涵蓋「最近想再打的幾張」又不讓 blob 無限長;
// 顯示層自訂可視高度 + 捲軸。釘選項目不受淘汰,故上限實際只在未釘選區生效。
const MAX_ENTRIES = 30;

/** 一筆最近 BSR:代號 + 顯示歌名(缺歌名時退回代號)+ 是否釘選。刻意不存封面/分數(見 grilling)。 */
export interface RecentBsr {
  readonly code: string;
  readonly songName: string;
  readonly pinned: boolean;
}

/**
 * 把任意來源(壞 JSON / 被竄改 / 舊格式)強制成合法清單並維持不變式。純函式,可測。
 * - 非陣列 → 空;逐筆丟棄壞項(缺/非字串/空字串 code);以 code 去重(保留較前 = 較新的一筆)。
 * - 歌名非字串 / 空字串時退回 code;pinned 非 true 一律當 false(舊存檔缺此欄 → 未釘選)。
 * - 不變式:所有釘選項目排在所有未釘選項目之前;兩群各自維持相對序(穩定分割)。
 * - 截到上限:因釘選在前,從尾端截 = 先砍最舊的未釘選,釘選項目不被淘汰。
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
    out.push({ code, songName: name, pinned: obj.pinned === true });
  }
  // 釘選置前(穩定分割:兩群各自維持相對序),再從尾端截到上限。
  const pinned = out.filter((r) => r.pinned);
  const unpinned = out.filter((r) => !r.pinned);
  return [...pinned, ...unpinned].slice(0, MAX_ENTRIES);
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

function save(next: RecentBsr[]): RecentBsr[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 寫入失敗(配額 / 停用)不該影響載入
  }
  return next;
}

/**
 * 記一筆最近 BSR。回傳更新後清單供呼叫端就地重繪。
 * - 已存在且已釘選:位置不動(釘選區凍結),只更新歌名。
 * - 已存在且未釘選 / 全新:置於未釘選區最頂、更新歌名;超量時最舊的未釘選被淘汰,
 *   若已釘滿上限、無未釘選可淘汰,則新的一筆會在截斷時落尾被丟棄(= 不記錄)。
 */
export function recordRecentBsr(code: string, songName: string): RecentBsr[] {
  const current = loadRecentBsr();
  if (current.find((r) => r.code === code)?.pinned) {
    return save(coerceRecentBsr(current.map((r) => (r.code === code ? { ...r, songName } : r))));
  }
  return save(coerceRecentBsr([{ code, songName, pinned: false }, ...current]));
}

/**
 * 切換釘選狀態。翻旗標後由 coerceRecentBsr 的穩定分割自然定位:
 * 釘選(false→true) → 落到釘選區最底;取消釘選(true→false) → 落到未釘選區最頂(= 第一個未釘選)。
 * 回傳更新後清單供呼叫端就地重繪。
 */
export function togglePinnedRecentBsr(code: string): RecentBsr[] {
  const current = loadRecentBsr();
  return save(coerceRecentBsr(current.map((r) => (r.code === code ? { ...r, pinned: !r.pinned } : r))));
}
