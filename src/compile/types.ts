// compile 層的核心資料形狀。所有欄位皆可決定性,無 I/O、音訊、渲染相依。

/** 左手或右手,由音符顏色決定(紅=左、藍=右)。 */
export type Hand = 'left' | 'right';

/** 一隻手的手指,由欄決定(空間順序保留)。 */
export type Finger = 'pinky' | 'ring' | 'middle' | 'index';

/** 鍵盤上/家/下排,由列決定。 */
export type Bank = 'top' | 'home' | 'bottom';

/** 音符種類。01 僅產生 press;hold 於 issue 03/08 才出現。 */
export type NoteKind = 'press' | 'hold';

/** TypingChart 的一個元素:一次一鍵的按鍵事件。 */
export interface Note {
  /** 相對音訊起點的秒數(已含 _songTimeOffset;不含使用者校準)。 */
  readonly tSec: number;
  /** 實體按鍵碼(KeyboardEvent.code),如 "KeyF"、"Semicolon"。 */
  readonly key: string;
  readonly kind: NoteKind;
  /** 僅 hold:長按結束秒數。 */
  readonly holdEndSec?: number;
  // ── 渲染中繼(比 key 更原始;映射表為 (hand,finger,bank) → key)──
  readonly hand: Hand;
  readonly finger: Finger;
  readonly bank: Bank;
}

/** compileChart 的輸出:依 tSec 排序、一次一鍵的按鍵時間軸。 */
export type TypingChart = readonly Note[];

/** compileChart 的組態。01 尚無編譯期 config;後續 issue(burst 間隔、hold 容差等)擴充。 */
export interface CompileConfig {
  readonly _reserved?: never;
}

/** 一個難度的指標(來自 Info.dat)。 */
export interface DifficultyRef {
  readonly characteristic: string; // 如 "Standard"
  readonly difficulty: string; // 如 "ExpertPlus"
  readonly filename: string; // 如 "ExpertPlusStandard.dat"
}

/** parseInfo 的輸出:Info.dat 的淺解析結果。 */
export interface SongInfo {
  readonly bpm: number;
  readonly songTimeOffset: number;
  readonly audioFilename: string;
  /** 給玩家看的歌名(Info.dat 的 _songName);缺漏時 undefined,由呼叫端 fallback。 */
  readonly songName?: string;
  readonly difficulties: readonly DifficultyRef[];
}

/** 交給 compileChart 的單首歌原始檔案(未解析文字)。 */
export interface RawMapFiles {
  /** Info.dat 的原始文字。 */
  readonly infoText: string;
  /** 難度檔:檔名 → 原始文字。惰性載入下通常只含選定的那個難度。 */
  readonly difficultyFiles: Readonly<Record<string, string>>;
}
