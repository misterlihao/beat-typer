// compile 層的核心資料形狀。所有欄位皆可決定性,無 I/O、音訊、渲染相依。

/** 左手或右手,由音符顏色決定(紅=左、藍=右)。 */
export type Hand = 'left' | 'right';

/** 一隻手的手指,是被指派鍵的屬性(由鍵指派決定;見 docs/adr/0008)。 */
export type Finger = 'pinky' | 'ring' | 'middle' | 'index';

/** 鍵盤上/家/下排,是被指派鍵的屬性(由鍵指派決定)。 */
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
  // ── 渲染中繼:hand 由顏色決定;finger/bank 為被指派鍵的屬性(高速公路實際靠 key 定道)。──
  readonly hand: Hand;
  readonly finger: Finger;
  readonly bank: Bank;
}

/** compileChart 的輸出:依 tSec 排序、一次一鍵的按鍵時間軸。 */
export type TypingChart = readonly Note[];

/** compileChart 的組態。 */
export interface CompileConfig {
  /** 鍵指派可玩性硬底線:同手同指的最小間隔秒數(預設 0.12)。見 docs/adr/0008。 */
  readonly minSameFingerGapSec?: number;
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
  /** 封面圖檔名(Info.dat 的 _coverImageFilename);缺漏/空字串時 undefined,由呼叫端改用佔位圖。 */
  readonly coverFilename?: string;
  readonly difficulties: readonly DifficultyRef[];
}

/** 交給 compileChart 的單首歌原始檔案(未解析文字)。 */
export interface RawMapFiles {
  /** Info.dat 的原始文字。 */
  readonly infoText: string;
  /** 難度檔:檔名 → 原始文字。惰性載入下通常只含選定的那個難度。 */
  readonly difficultyFiles: Readonly<Record<string, string>>;
}
