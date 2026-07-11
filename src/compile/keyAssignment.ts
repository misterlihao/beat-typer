// 鍵指派(Key Assignment):在單場內把每顆音符指派到一個鍵盤鍵,追求打字練習價值而非
// 還原 Beat Saber 空間。純函式、可決定性(無 RNG)——同一批音符永遠得到同一組指派。
// 見 docs/adr/0008、CONTEXT「鍵指派 / 教學權重 / 可玩性」。
//
// 手由顏色決定(呼叫端已填),此處只在該手內選手指/排/鍵:
//  - 朝「教學權重」攤平各鍵出現量(家排>上>下、食指/中指>無名/小指;內側鍵打折)。
//  - 可玩性硬底線:同一手、時間相鄰過近者不指派同一手指。
import { innerKeyFor, keyFor } from './mapping.ts';
import type { Bank, Finger, Hand, KeyGroup, Note } from './types.ts';

/** 待指派音符:已知時間、手、種類,尚未決定手指/排/鍵。 */
export interface UnassignedNote {
  readonly tSec: number;
  readonly hand: Hand;
  readonly kind: 'press' | 'hold';
  readonly holdEndSec?: number;
}

// 教學權重因子:家排>上排>下排、食指/中指>無名/小指;內側鍵(食指 reach)再打折。
const BANK_WEIGHT: Record<Bank, number> = { home: 3, top: 2, bottom: 1 };
const FINGER_WEIGHT: Record<Finger, number> = { index: 3, middle: 3, ring: 2, pinky: 1 };
const INNER_PENALTY = 0.5;

const BANKS: readonly Bank[] = ['home', 'top', 'bottom'];
const FINGERS: readonly Finger[] = ['index', 'middle', 'ring', 'pinky'];

/** 鍵池的一個候選:某手可用的一個鍵 + 教學權重 + 可玩性所需的手指。 */
interface PoolKey {
  readonly finger: Finger;
  readonly bank: Bank;
  readonly key: string;
  readonly weight: number;
}

// 鍵群 → 排/指過濾(缺欄位=不限制該維度)。權威清單見 compile/types.ts KEY_GROUPS;見 docs/adr/0011。
const GROUP_FILTER: Record<KeyGroup, { banks?: readonly Bank[]; fingers?: readonly Finger[] }> = {
  all: {},
  home: { banks: ['home'] },
  'home-top': { banks: ['home', 'top'] },
  'index-middle': { fingers: ['index', 'middle'] },
  'ring-pinky': { fingers: ['ring', 'pinky'] },
};

/**
 * 建某手的鍵池:12 個一般鍵 + 3 個內側鍵(食指),各帶教學權重;再依鍵群過濾成子集。
 * 鍵群一律雙手對稱且皆非空(見 docs/adr/0011),故過濾後至少仍有數鍵。
 */
function buildPool(hand: Hand, keyGroup: KeyGroup): PoolKey[] {
  const pool: PoolKey[] = [];
  for (const finger of FINGERS) {
    for (const bank of BANKS) {
      pool.push({ finger, bank, key: keyFor(hand, finger, bank), weight: FINGER_WEIGHT[finger] * BANK_WEIGHT[bank] });
    }
  }
  for (const bank of BANKS) {
    pool.push({ finger: 'index', bank, key: innerKeyFor(hand, bank), weight: FINGER_WEIGHT.index * BANK_WEIGHT[bank] * INNER_PENALTY });
  }
  const { banks, fingers } = GROUP_FILTER[keyGroup];
  return pool.filter((p) => (!banks || banks.includes(p.bank)) && (!fingers || fingers.includes(p.finger)));
}

// 某手目前佔用中的手指(recent press 或進行中的 hold + 恢復窗)。
interface Occupancy {
  readonly finger: Finger;
  readonly until: number; // 佔用到此秒數為止(> note.tSec 即視為仍佔用)
}

/**
 * 把待指派音符(須依 tSec 遞增)逐一指派成 Note。
 * @param notes 依時間排序的待指派音符
 * @param minSameFingerGapSec 可玩性硬底線:同手同指的最小間隔秒數
 * @param keyGroup 訓練鍵群:限縮雙手鍵池到子集(預設 'all' 不限制)。降級時只在群內放寬。
 */
export function assignKeys(
  notes: readonly UnassignedNote[],
  minSameFingerGapSec: number,
  keyGroup: KeyGroup = 'all',
): Note[] {
  const pools: Record<Hand, PoolKey[]> = { left: buildPool('left', keyGroup), right: buildPool('right', keyGroup) };
  const count: Record<string, number> = {}; // 鍵碼 → 已指派次數(左右手鍵碼不重疊)
  const active: Record<Hand, Occupancy[]> = { left: [], right: [] };

  const out: Note[] = [];
  for (const n of notes) {
    const hand = n.hand;

    // 丟掉已過期的佔用,收集仍佔用的手指。
    const live = active[hand].filter((o) => o.until > n.tSec);
    active[hand] = live;
    const blocked = new Set<Finger>(live.map((o) => o.finger));

    // 可玩性:剔除仍被佔用的手指;若全被佔(極高速下物理上不可能滿足)→ 放寬回整池。
    const pool = pools[hand];
    let candidates = pool.filter((p) => !blocked.has(p.finger));
    if (candidates.length === 0) candidates = pool;

    // D'Hondt 最高平均法:選 weight/(count+1) 最大者,使出現量長期正比於教學權重;
    // count=0 的鍵商數最高 → 未用鍵會盡早被選到(覆蓋)。pool 固定順序做確定性 tie-break。
    let best = candidates[0]!;
    let bestQ = best.weight / ((count[best.key] ?? 0) + 1);
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i]!;
      const q = c.weight / ((count[c.key] ?? 0) + 1);
      if (q > bestQ) {
        best = c;
        bestQ = q;
      }
    }

    count[best.key] = (count[best.key] ?? 0) + 1;
    const endSec = n.kind === 'hold' ? (n.holdEndSec ?? n.tSec) : n.tSec;
    active[hand].push({ finger: best.finger, until: endSec + minSameFingerGapSec });

    out.push({
      tSec: n.tSec,
      key: best.key,
      kind: n.kind,
      ...(n.holdEndSec !== undefined ? { holdEndSec: n.holdEndSec } : {}),
      hand,
      finger: best.finger,
      bank: best.bank,
    });
  }
  return out;
}
