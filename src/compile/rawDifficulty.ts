// 原始難度檔的共用形狀與判別:格式偵測 + BPM 時間線讀取。
// 由 compileChart(音符)與 compileLightShow(燈光)共用,確保兩者的 beat→秒同源、
// 不會各自複製一份而漂移(見 docs/adr/0009 的變速陷阱)。純函式、無 I/O。
import type { BpmSegment } from './bpmTimeline.ts';

/** 難度檔中與格式判別 / 變速換算有關的欄位(音符 / 燈光欄位各自在自己的模組讀)。 */
export interface RawDifficultyMeta {
  version?: string; // v3:"3.x"
  _version?: string; // v2:"2.x"
  colorNotes?: unknown; // v3 音符陣列(格式後備判準)
  _notes?: unknown; // v2 音符陣列(格式後備判準)
  bpmEvents?: unknown; // v3 變速事件 [{b,m}]
}

interface RawV3BpmEvent {
  b?: number; // beat
  m?: number; // bpm
}

/** 判定難度檔格式:version 字串為主判準,音符陣列存在與否為後備。 */
export function detectFormat(diff: RawDifficultyMeta): 'v2' | 'v3' | null {
  const version = diff.version ?? diff._version ?? '';
  if (version.startsWith('3')) return 'v3';
  if (version.startsWith('2')) return 'v2';
  if (Array.isArray(diff.colorNotes)) return 'v3';
  if (Array.isArray(diff._notes)) return 'v2';
  return null;
}

/**
 * 讀出格式無關的 BPM 時間線(供 buildBeatToSec)。
 * v3:讀頂層 `bpmEvents`([{b,m}])。
 * v2:一律等速——`_customData._BPMChanges` 是編輯器顯示用,本體不讀,故回空陣列(見 docs/adr/0009)。
 */
export function readBpmTimeline(diff: RawDifficultyMeta, format: 'v2' | 'v3'): BpmSegment[] {
  if (format !== 'v3' || !Array.isArray(diff.bpmEvents)) return [];
  const out: BpmSegment[] = [];
  for (const e of diff.bpmEvents as RawV3BpmEvent[]) {
    if (typeof e?.b === 'number' && typeof e?.m === 'number') out.push({ beat: e.b, bpm: e.m });
  }
  return out;
}
