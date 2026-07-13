// 自製譜面文字格式解析(issue 22 階段一)。純函式、可決定性、無 I/O。
// 作者用陽春文字排音符,一行一顆:
//
//   拍  手  種類[!]  [結束拍]
//
//   - 拍:非負數(可小數)。落在配樂的第幾拍;compileChart 用該 BSR 的 BPM 換算成秒。
//   - 手:L / R(不分大小寫)→ 左(紅)/ 右(藍)。
//   - 種類:press / hold(不分大小寫);尾綴 `!` = 強調(如 press! / hold!)。
//   - 結束拍:僅 hold 需要,須大於起始拍。
//   - `#` 起註解、空白行:略過。
//
// 產物是一份「合成 v3 難度檔文字」,塞進 RawMapFiles.difficultyFiles 後續走 compileChart——
// 不新開繞過正規化的第二條路(見 issue 22)。強調寫進自訂欄位 `e`,compileChart 讀它成 Note.emphasized。
// 變速:若基底歌有變速,把其 BPM 時間線也寫進生成檔的 bpmEvents,讓自製拍落在與原曲一致的秒數上。
import type { BpmSegment } from './bpmTimeline.ts';

/** 解析後的一顆自製音符(格式無關中繼)。 */
export interface CustomNote {
  readonly beat: number;
  readonly hand: 'left' | 'right';
  readonly kind: 'press' | 'hold';
  readonly emphasized: boolean;
  /** 僅 hold:結束拍(必 > beat)。 */
  readonly endBeat?: number;
}

/** 顏色碼:紅 0 = 左、藍 1 = 右(與 compileChart handOf 一致)。 */
const COLOR: Record<'left' | 'right', number> = { left: 0, right: 1 };

/**
 * 解析自製譜面文字成音符列。可決定性、可測。
 * 逐行檢查,蒐集所有錯誤;有任何一行不合法即 throw,訊息逐行列出(含行號),供編輯器紅字顯示。
 */
export function parseCustomChart(text: string): CustomNote[] {
  const notes: CustomNote[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    // 去註解(# 之後)再 trim;空行略過。
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') return;

    const tokens = line.split(/\s+/);
    const [beatTok, handTok, kindTok, endTok, ...rest] = tokens;

    if (rest.length > 0) {
      errors.push(`第 ${lineNo} 行:欄位過多「${line}」`);
      return;
    }
    if (!beatTok || !handTok || !kindTok) {
      errors.push(`第 ${lineNo} 行:格式應為「拍 手 種類[!] [結束拍]」,得到「${line}」`);
      return;
    }

    // 拍。
    const beat = Number(beatTok);
    if (!Number.isFinite(beat) || beat < 0) {
      errors.push(`第 ${lineNo} 行:拍須為非負數,得到「${beatTok}」`);
      return;
    }

    // 手。
    const h = handTok.toLowerCase();
    if (h !== 'l' && h !== 'r') {
      errors.push(`第 ${lineNo} 行:手須為 L 或 R,得到「${handTok}」`);
      return;
    }
    const hand: 'left' | 'right' = h === 'l' ? 'left' : 'right';

    // 種類(+ 尾綴 ! = 強調)。
    const emphasized = kindTok.endsWith('!');
    const kindName = (emphasized ? kindTok.slice(0, -1) : kindTok).toLowerCase();
    if (kindName !== 'press' && kindName !== 'hold') {
      errors.push(`第 ${lineNo} 行:種類須為 press 或 hold(可加 ! 強調),得到「${kindTok}」`);
      return;
    }
    const kind: 'press' | 'hold' = kindName;

    // 結束拍:hold 必須、press 不可。
    if (kind === 'hold') {
      if (endTok === undefined) {
        errors.push(`第 ${lineNo} 行:hold 需要結束拍`);
        return;
      }
      const endBeat = Number(endTok);
      if (!Number.isFinite(endBeat)) {
        errors.push(`第 ${lineNo} 行:結束拍須為數字,得到「${endTok}」`);
        return;
      }
      if (endBeat <= beat) {
        errors.push(`第 ${lineNo} 行:結束拍(${endTok})須大於起始拍(${beatTok})`);
        return;
      }
      notes.push({ beat, hand, kind, emphasized, endBeat });
    } else {
      if (endTok !== undefined) {
        errors.push(`第 ${lineNo} 行:press 不該有結束拍「${endTok}」`);
        return;
      }
      notes.push({ beat, hand, kind, emphasized });
    }
  });

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return notes;
}

/**
 * 把自製音符列組成一份合成 v3 難度檔文字。press→colorNotes、hold→sliders;
 * 強調寫進自訂欄位 `e`。欄/列(x/y)本作不用(compileChart 只讀拍+顏色),固定填 0。
 * @param bpmSegments 基底歌的變速表(選填):寫進 bpmEvents,讓自製拍與原曲同拍同秒。空 = 等速。
 */
export function customChartToDiffText(
  notes: readonly CustomNote[],
  bpmSegments: readonly BpmSegment[] = [],
): string {
  const colorNotes: object[] = [];
  const sliders: object[] = [];
  for (const n of notes) {
    const c = COLOR[n.hand];
    if (n.kind === 'hold') {
      sliders.push({ b: n.beat, x: 0, y: 0, c, tb: n.endBeat ?? n.beat, tx: 0, ty: 0, e: n.emphasized });
    } else {
      colorNotes.push({ b: n.beat, x: 0, y: 0, c, e: n.emphasized });
    }
  }
  const bpmEvents = bpmSegments.map((s) => ({ b: s.beat, m: s.bpm }));
  return JSON.stringify({ version: '3.2.0', colorNotes, sliders, bpmEvents, bombNotes: [], obstacles: [], burstSliders: [] });
}
