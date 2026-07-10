// BPM 時間線 → beat→秒 的純函式。支援曲中變速(分段常數 BPM 積分)。
// 見 docs/adr/0009、CONTEXT「變速」。來源(v3 bpmEvents / v2 _customData._BPMChanges)的
// 讀取與正規化在 compileChart 的 v2/v3 分流做;此處只吃格式無關的 [{beat,bpm}]。

/** BPM 時間線的一段:自 beat 起,以 bpm 播放,直到下一段。 */
export interface BpmSegment {
  readonly beat: number;
  readonly bpm: number;
}

interface BuiltSeg {
  readonly startBeat: number;
  readonly bpm: number;
  readonly startSec: number; // 此段起點對應的秒數(未含 songTimeOffset)
}

/**
 * 建 beat→秒 純函式。時間線為分段常數 BPM;baseBpm(Info.dat)覆蓋 [0, 首段beat) 與「無時間線」全曲。
 * 空 / 無效項 → 以 baseBpm 常數換算(與舊行為一致,不回歸)。
 * 健壯:濾掉 bpm≤0 / beat<0 / 非數,依 beat 排序,同 beat 取最後者。
 */
export function buildBeatToSec(timeline: readonly BpmSegment[], baseBpm: number): (beat: number) => number {
  const clean = timeline
    .filter((s) => Number.isFinite(s.beat) && Number.isFinite(s.bpm) && s.bpm > 0 && s.beat >= 0)
    .slice()
    .sort((a, b) => a.beat - b.beat);

  // 同 beat 去重,保留最後一筆(後寫覆蓋)。
  const dedup: BpmSegment[] = [];
  for (const s of clean) {
    if (dedup.length && dedup[dedup.length - 1]!.beat === s.beat) dedup[dedup.length - 1] = s;
    else dedup.push(s);
  }

  const segs: BuiltSeg[] = [];
  const push = (startBeat: number, bpm: number) => {
    const prev = segs[segs.length - 1];
    const startSec = prev ? prev.startSec + (startBeat - prev.startBeat) * (60 / prev.bpm) : 0;
    segs.push({ startBeat, bpm, startSec });
  };

  // 首段:若無時間線或首事件不在 beat 0,以 baseBpm 從 beat 0 起。
  if (dedup.length === 0 || dedup[0]!.beat > 0) push(0, baseBpm > 0 ? baseBpm : 120);
  for (const s of dedup) {
    if (segs.length && segs[segs.length - 1]!.startBeat === s.beat) continue; // beat 0 已由首事件建立
    push(s.beat, s.bpm);
  }

  return (beat: number): number => {
    // 二分找最後一個 startBeat ≤ beat 的段。
    let lo = 0;
    let hi = segs.length - 1;
    let si = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid]!.startBeat <= beat) {
        si = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const seg = segs[si]!;
    return seg.startSec + (beat - seg.startBeat) * (60 / seg.bpm);
  };
}
