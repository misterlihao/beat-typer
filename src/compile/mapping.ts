// 鍵盤鍵的來源表:(hand, finger, bank) → 實體按鍵碼,以及 code → 顯示字形。
// 這裡只描述「鍵盤上哪個位置是哪個鍵」;音符「該對到哪個鍵」由鍵指派決定(見 keyAssignment.ts、
// docs/adr/0008)。key → 高速公路道的對應在 highway 層(KEY_LAYOUT)。
import type { Bank, Finger, Hand } from './types.ts';

// (hand, finger, bank) → 實體按鍵碼(KeyboardEvent.code)。全格鍵盤位置表。
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
