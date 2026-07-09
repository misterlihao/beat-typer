// (顏色, 欄, 列) → 鍵盤鍵 的唯一映射。見 docs/adr/0002、0003 與 CONTEXT.md。
//
// 空間順序保留:同一手內,欄由左到右 = 該手手指由左到右。
// 故左手 col3、右手 col0 都落在食指(鍵盤中央的內側定位鍵)。
import type { Bank, Finger, Hand } from './types.ts';

/** Beat Saber 顏色(type):0=紅=左手、1=藍=右手。 */
export function colorToHand(color: number): Hand {
  return color === 0 ? 'left' : 'right';
}

/** 列(lineLayer):0=下、1=家、2=上。 */
export function layerToBank(layer: number): Bank {
  switch (layer) {
    case 2:
      return 'top';
    case 1:
      return 'home';
    case 0:
      return 'bottom';
    default:
      throw new Error(`不支援的列(lineLayer=${layer}),應為 0..2`);
  }
}

// 欄(0..3,由左到右)→ 該手手指。空間順序:兩手皆左→右,食指在內側。
const LEFT_FINGERS: readonly Finger[] = ['pinky', 'ring', 'middle', 'index'];
const RIGHT_FINGERS: readonly Finger[] = ['index', 'middle', 'ring', 'pinky'];

/** 欄(lineIndex)→ 手指,依手別套用空間順序。 */
export function columnToFinger(hand: Hand, column: number): Finger {
  const table = hand === 'left' ? LEFT_FINGERS : RIGHT_FINGERS;
  const finger = table[column];
  if (finger === undefined) {
    throw new Error(`不支援的欄(lineIndex=${column}),應為 0..3`);
  }
  return finger;
}

// (hand, finger, bank) → 實體按鍵碼(KeyboardEvent.code)。全格映射表。
const KEY_GRID: Record<Hand, Record<Finger, Record<Bank, string>>> = {
  left: {
    pinky: { top: 'KeyQ', home: 'KeyA', bottom: 'KeyZ' },
    ring: { top: 'KeyW', home: 'KeyS', bottom: 'KeyX' },
    middle: { top: 'KeyE', home: 'KeyD', bottom: 'KeyC' },
    index: { top: 'KeyR', home: 'KeyF', bottom: 'KeyV' },
  },
  right: {
    index: { top: 'KeyU', home: 'KeyJ', bottom: 'KeyM' },
    middle: { top: 'KeyI', home: 'KeyK', bottom: 'Comma' },
    ring: { top: 'KeyO', home: 'KeyL', bottom: 'Period' },
    pinky: { top: 'KeyP', home: 'Semicolon', bottom: 'Slash' },
  },
};

/** (hand, finger, bank) → 按鍵碼。 */
export function keyFor(hand: Hand, finger: Finger, bank: Bank): string {
  return KEY_GRID[hand][finger][bank];
}

// 內側鍵:同一根食指內側的三個列。用於同手疊放收斂後的強調音符(見 docs/adr/0006)。
const INNER_GRID: Record<Hand, Record<Bank, string>> = {
  left: { top: 'KeyT', home: 'KeyG', bottom: 'KeyB' },
  right: { top: 'KeyY', home: 'KeyH', bottom: 'KeyN' },
};

/** (hand, bank) → 內側鍵碼。內側鍵一律屬食指。 */
export function innerKeyFor(hand: Hand, bank: Bank): string {
  return INNER_GRID[hand][bank];
}

/** 一顆音符的完整映射結果。 */
export interface MappedKey {
  readonly hand: Hand;
  readonly finger: Finger;
  readonly bank: Bank;
  readonly key: string;
}

/** 把 Beat Saber (color, column, layer) 映射成鍵盤鍵與渲染中繼。 */
export function mapNote(color: number, column: number, layer: number): MappedKey {
  const hand = colorToHand(color);
  const finger = columnToFinger(hand, column);
  const bank = layerToBank(layer);
  return { hand, finger, bank, key: keyFor(hand, finger, bank) };
}

// 非字母按鍵碼 → 顯示字形。字母碼("KeyF")一律去掉 "Key" 前綴。
const SYMBOL_GLYPHS: Readonly<Record<string, string>> = {
  Semicolon: ';',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** 按鍵碼 → 給玩家看的顯示字元。純顯示投影,不存進 Note。 */
export function glyphOf(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  return SYMBOL_GLYPHS[code] ?? code;
}
