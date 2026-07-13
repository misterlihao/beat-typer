// 資料匯出 / 匯入(issue 26):把三個 localStorage store 倒成一份可攜備份、在別的裝置匯入。
// 純函式 buildBackup / parseBackup / mergeBackup 可測(主接縫);下載 / 選檔 / 寫回為薄 I/O(不 mock、不測)。
// 完全複用三 store 既有的 coerce*(單一防呆真相來源),不另寫驗證。
import {
  coerceScores,
  adjustedAccuracy,
  loadScores,
  type ScoreStore,
  type ScoreRecord,
} from '../scores/scores.ts';
import { coerceSettings, loadSettings, patchSettings, type Settings } from '../settings/settings.ts';
import { coerceRecentBsr, loadRecentBsr, type RecentBsr } from '../loader/recentBsr.ts';

const APP = 'beat-typer';
const KIND = 'backup';
const BACKUP_VERSION = 1;
const SCORES_STORAGE_KEY = 'beat-typer:scores';
const RECENT_STORAGE_KEY = 'beat-typer:recent-bsr';

/** 一份備份涵蓋的三個 store(皆已 coerce)。 */
export interface BackupData {
  readonly settings: Settings;
  readonly scores: ScoreStore;
  readonly recentBsr: RecentBsr[];
}

/** 匯出信封:app / version 供匯入認出「這是不是本 app 的備份」;data 存解析後物件(人可讀)。 */
export interface Backup {
  readonly app: typeof APP;
  readonly kind: typeof KIND;
  readonly version: number;
  readonly exportedAt: string;
  readonly data: BackupData;
}

export type ImportMode = 'merge' | 'replace';

export type ParseResult =
  | { readonly ok: true; readonly data: BackupData }
  | { readonly ok: false; readonly reason: string };

// ── 純函式(主測試接縫)──

/** 由三 store 現值組信封;exportedAt 由呼叫端注入(純函式不碰時鐘)。 */
export function buildBackup(data: BackupData, exportedAt: string): Backup {
  return { app: APP, kind: KIND, version: BACKUP_VERSION, exportedAt, data };
}

/**
 * 認信封 + 逐 store 過 coerce*。非本 app / 版本不認 → ok:false(整份拒絕、不寫入);
 * 合法信封但某 store 壞 / 部分紀錄壞 → coerce* salvage(壞的丟、好的留)。純函式,可測。
 */
export function parseBackup(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: '不是有效的備份檔' };
  const o = raw as Record<string, unknown>;
  if (o.app !== APP) return { ok: false, reason: '這不是 Beat Typer 的備份檔' };
  if (o.version !== BACKUP_VERSION) return { ok: false, reason: `不支援的備份版本(${String(o.version)})` };
  const d = (typeof o.data === 'object' && o.data !== null ? o.data : {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      settings: coerceSettings(d.settings),
      scores: coerceScores(d.scores),
      recentBsr: coerceRecentBsr(d.recentBsr),
    },
  };
}

/** 兩筆同譜紀錄取較佳:準確率比調整後值(raw+鍵群成對搬移)、combo 取 max、FC 取 OR。 */
function betterRecord(x: ScoreRecord, y: ScoreRecord): ScoreRecord {
  const acc =
    adjustedAccuracy(y.bestRawAccuracy, y.bestKeyGroup) > adjustedAccuracy(x.bestRawAccuracy, x.bestKeyGroup)
      ? y
      : x;
  return {
    bestRawAccuracy: acc.bestRawAccuracy,
    bestKeyGroup: acc.bestKeyGroup,
    bestMaxCombo: Math.max(x.bestMaxCombo, y.bestMaxCombo),
    everFullCombo: x.everFullCombo || y.everFullCombo,
  };
}

/** 逐歌曲身分聯集:兩邊都有 → betterRecord,單邊有 → 直接收。 */
function mergeScores(current: ScoreStore, incoming: ScoreStore): ScoreStore {
  const records: Record<string, ScoreRecord> = { ...current.records };
  for (const [key, rec] of Object.entries(incoming.records)) {
    const prev = records[key];
    records[key] = prev ? betterRecord(prev, rec) : rec;
  }
  return { version: current.version, records };
}

/**
 * 最近清單聯集:以代號去重、任一邊釘選即保留釘選、current(B)項目排前面(先插入)。
 * 歌名優先留 current 的(present),交給 coerceRecentBsr 做穩定分割 + 30 上限。
 */
function mergeRecent(current: RecentBsr[], incoming: RecentBsr[]): RecentBsr[] {
  const byCode = new Map<string, RecentBsr>();
  for (const r of current) byCode.set(r.code, { ...r });
  for (const r of incoming) {
    const prev = byCode.get(r.code);
    if (!prev) byCode.set(r.code, { ...r });
    else byCode.set(r.code, { ...prev, pinned: prev.pinned || r.pinned });
  }
  return coerceRecentBsr([...byCode.values()]);
}

/**
 * 併入策略。覆蓋 = 三 store 全取 incoming;合併 = 不碰 current 的設定,
 * 成績逐譜取較佳、最近清單聯集去重(見上)。純函式,可測。
 */
export function mergeBackup(current: BackupData, incoming: BackupData, mode: ImportMode): BackupData {
  if (mode === 'replace') return incoming;
  return {
    settings: current.settings, // 合併不碰 B 的手感偏好
    scores: mergeScores(current.scores, incoming.scores),
    recentBsr: mergeRecent(current.recentBsr, incoming.recentBsr),
  };
}

// ── 薄 I/O(不 mock、不測)──

/** 讀三 store 現值(各自 coerce 過)。 */
function loadAll(): BackupData {
  return { settings: loadSettings(), scores: loadScores(), recentBsr: loadRecentBsr() };
}

/** 匯出:讀三 store → 組信封 → 觸發 .json 下載。檔名帶當日日期。 */
export function exportBackup(): void {
  const now = new Date();
  const backup = buildBackup(loadAll(), now.toISOString());
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `beat-typer-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 匯入結果:成功回併入後計數供回饋顯示;失敗回原因供就地報錯。 */
export type ImportResult =
  | { readonly ok: true; readonly scoreCount: number; readonly recentCount: number }
  | { readonly ok: false; readonly reason: string };

/**
 * 匯入:parse 檔文字 → 與現值 merge → 分別寫回三 store。
 * parse 失敗一律不寫入任何東西。設定寫回走 patchSettings;成績 / 最近直接寫 blob(覆蓋整包)。
 */
export function importBackup(text: string, mode: ImportMode): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '檔案不是有效的 JSON' };
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const next = mergeBackup(loadAll(), parsed.data, mode);
  if (mode === 'replace') patchSettings(next.settings); // 覆蓋才動設定;合併保留 B 的
  try {
    localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(next.scores));
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next.recentBsr));
  } catch {
    // 寫入失敗(配額 / 停用)→ 視為匯入失敗
    return { ok: false, reason: '寫入失敗(儲存空間不足或被停用)' };
  }
  return {
    ok: true,
    scoreCount: Object.keys(next.scores.records).length,
    recentCount: next.recentBsr.length,
  };
}
