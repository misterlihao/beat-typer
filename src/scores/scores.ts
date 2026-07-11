// 成績持久化(issue 18):跨場記住每張譜的最佳成績。見 docs/adr/0013、CONTEXT「成績持久化」。
// 純函式(songKey / adjustedAccuracy / applyRun / coerceScores)可測;localStorage 讀寫為薄 I/O,不 mock、不測。
// 歌曲身分 = 難度檔原始文字雜湊(per-難度、跨來源一致、內容真實)。跨鍵群靠「調整後準確率」共爭單一最佳。
import { keyGroupPoolSize } from '../compile/keyAssignment.ts';
import { KEY_GROUPS, type KeyGroup } from '../compile/types.ts';

const STORAGE_KEY = 'beat-typer:scores';
const SCORES_VERSION = 1;

/** 一張譜(一個歌曲身分)的歷來最佳。調整後準確率即時導出,不存。 */
export interface ScoreRecord {
  readonly bestRawAccuracy: number; // 0..1,達成最佳「調整後準確率」那場的原始準確率
  readonly bestKeyGroup: KeyGroup; // 達成上者的鍵群(供顯示脈絡 + 導出調整值)
  readonly bestMaxCombo: number; // 只在全鍵解鎖
  readonly everFullCombo: boolean; // 只在全鍵解鎖
}

/** 一場完賽結果(從 judge summary 取)。 */
export interface RunResult {
  readonly rawAccuracy: number;
  readonly keyGroup: KeyGroup;
  readonly maxCombo: number;
  readonly fullCombo: boolean;
}

/** localStorage 內的整包成績。 */
export interface ScoreStore {
  readonly version: number;
  readonly records: Record<string, ScoreRecord>;
}

// ── 純函式 ──

/**
 * 歌曲身分鍵:難度檔原始文字的雜湊。兩個獨立 32-bit 雜湊(djb2 + sdbm)接成 base36,降低撞鍵。
 * 可決定性:同文字永得同鍵;不需 crypto(個人譜庫規模,撞鍵風險可忽略)。
 */
export function songKey(diffText: string): string {
  let h1 = 5381; // djb2(xor 變體)
  let h2 = 0; // sdbm
  for (let i = 0; i < diffText.length; i++) {
    const c = diffText.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = (c + (h2 << 6) + (h2 << 16) - h2) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/** 鍵群係數:仁慈壓縮曲線,由每手鍵池大小導出(全鍵 1.0)。見 docs/adr/0013。 */
export function coefficientFor(keyGroup: KeyGroup): number {
  return 0.5 + 0.5 * (keyGroupPoolSize(keyGroup) / keyGroupPoolSize('all'));
}

/** 調整後準確率 = 原始 × 鍵群係數;跨鍵群唯一可比的分數。 */
export function adjustedAccuracy(rawAccuracy: number, keyGroup: KeyGroup): number {
  return rawAccuracy * coefficientFor(keyGroup);
}

/**
 * 把一場結果併進紀錄,回傳新紀錄 + 是否刷新。純函式,prev 可為 undefined(首玩)。
 * 準確率以調整後值排名;最大 combo 與全連只在全鍵(all)解鎖計入(小鍵群太好拿)。
 */
export function applyRun(
  prev: ScoreRecord | undefined,
  run: RunResult,
): { record: ScoreRecord; improved: boolean } {
  const prevAdj = prev ? adjustedAccuracy(prev.bestRawAccuracy, prev.bestKeyGroup) : -1;
  const runAdj = adjustedAccuracy(run.rawAccuracy, run.keyGroup);
  const accImproved = runAdj > prevAdj;

  const isAll = run.keyGroup === 'all';
  const prevCombo = prev?.bestMaxCombo ?? 0;
  const prevFC = prev?.everFullCombo ?? false;
  const comboImproved = isAll && run.maxCombo > prevCombo;
  const fcImproved = isAll && run.fullCombo && !prevFC;

  const record: ScoreRecord = {
    bestRawAccuracy: accImproved ? run.rawAccuracy : (prev?.bestRawAccuracy ?? run.rawAccuracy),
    bestKeyGroup: accImproved ? run.keyGroup : (prev?.bestKeyGroup ?? run.keyGroup),
    bestMaxCombo: isAll ? Math.max(prevCombo, run.maxCombo) : prevCombo,
    everFullCombo: prevFC || (isAll && run.fullCombo),
  };
  return { record, improved: accImproved || comboImproved || fcImproved };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 驗一筆紀錄;任一欄位型別/值不合即回 null(丟棄該筆)。 */
function coerceRecord(raw: unknown): ScoreRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.bestRawAccuracy !== 'number' || !Number.isFinite(o.bestRawAccuracy)) return null;
  if (!KEY_GROUPS.includes(o.bestKeyGroup as KeyGroup)) return null;
  if (typeof o.bestMaxCombo !== 'number' || !Number.isFinite(o.bestMaxCombo)) return null;
  if (typeof o.everFullCombo !== 'boolean') return null;
  return {
    bestRawAccuracy: clamp01(o.bestRawAccuracy),
    bestKeyGroup: o.bestKeyGroup as KeyGroup,
    bestMaxCombo: Math.max(0, Math.floor(o.bestMaxCombo)),
    everFullCombo: o.everFullCombo,
  };
}

/**
 * 把任意來源(壞 JSON、被竄改、舊版)強制成合法 ScoreStore:
 * 非物件 / 版本不符 / records 非物件 → 空庫;個別壞紀錄丟棄、好的保留。純函式,可測。
 */
export function coerceScores(raw: unknown): ScoreStore {
  const empty: ScoreStore = { version: SCORES_VERSION, records: {} };
  if (typeof raw !== 'object' || raw === null) return empty;
  const o = raw as Record<string, unknown>;
  if (o.version !== SCORES_VERSION) return empty; // 版本不符 → 丟棄重來(目前僅 v1)
  if (typeof o.records !== 'object' || o.records === null) return empty;
  const records: Record<string, ScoreRecord> = {};
  for (const [k, v] of Object.entries(o.records as Record<string, unknown>)) {
    const rec = coerceRecord(v);
    if (rec) records[k] = rec;
  }
  return { version: SCORES_VERSION, records };
}

// ── 薄 I/O(不 mock、不測)──

/** 讀成績庫;localStorage 不可用 / 空 / 壞 JSON 一律靜默回退空庫(coerceScores 補齊)。 */
export function loadScores(): ScoreStore {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text !== null) raw = JSON.parse(text);
  } catch {
    // localStorage 不可用或 JSON 壞掉 → 空庫
  }
  return coerceScores(raw);
}

/**
 * 記錄一場結果:讀庫 → 以難度檔身分併入 → 寫回;回傳新紀錄 + 是否刷新供結算顯示。
 * 寫入失敗(配額 / 停用)靜默略過。這是薄 I/O 包裝,邏輯在純函式 applyRun。
 */
export function recordRun(diffText: string, run: RunResult): { record: ScoreRecord; improved: boolean } {
  const store = loadScores();
  const key = songKey(diffText);
  const { record, improved } = applyRun(store.records[key], run);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store, records: { ...store.records, [key]: record } }));
  } catch {
    // 寫入失敗不該影響遊玩
  }
  return { record, improved };
}
