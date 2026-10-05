// What the keys ask of the deck (FR-PRS-002): the move or the full screen a key means, and the screen number being typed. No view in it, so the keyboard
// is tested with plain values. Clicker devices send the page keys and the arrows, which are the moves below.

/**
 * What a key asks of the deck.
 *
 * @public
 */
export type DeckAction =
  | {
      /** The action: a move (`next`, `prev`, `first`, `last`), `fullscreen`, `overview` (the grid of screens), or an edit of the screen number being typed (`commit`, `erase`, `cancel`). */
      readonly kind: 'next' | 'prev' | 'first' | 'last' | 'fullscreen' | 'overview' | 'commit' | 'erase' | 'cancel';
    }
  | {
      /** A digit of a screen number. */
      readonly kind: 'digit';
      /** The digit, `0` to `9`. */
      readonly digit: string;
    };

const NEXT: DeckAction = { kind: 'next' };
const PREV: DeckAction = { kind: 'prev' };
const FULLSCREEN: DeckAction = { kind: 'fullscreen' };
const OVERVIEW: DeckAction = { kind: 'overview' };

/** The keys that mean the same whatever is being typed. */
const KEYS: { readonly [key: string]: DeckAction } = {
  ArrowRight: NEXT,
  ArrowDown: NEXT,
  PageDown: NEXT,
  ' ': NEXT,
  Enter: NEXT,
  ArrowLeft: PREV,
  ArrowUp: PREV,
  PageUp: PREV,
  Backspace: PREV,
  Home: { kind: 'first' },
  End: { kind: 'last' },
  f: FULLSCREEN,
  F: FULLSCREEN,
  o: OVERVIEW,
  O: OVERVIEW,
};

/** What a few keys mean while a screen number is being typed: Enter commits it, Backspace erases a digit, Escape drops it. */
const TYPING: { readonly [key: string]: DeckAction } = { Enter: { kind: 'commit' }, Backspace: { kind: 'erase' }, Escape: { kind: 'cancel' } };

/**
 * The action of `key` (a digit is typed); `typing` says a screen number is waiting for Enter.
 *
 * @public
 */
export function deckAction(key: string, typing: boolean): DeckAction | undefined {
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: key };
  return (typing ? TYPING[key] : undefined) ?? KEYS[key];
}

/** The most digits a screen number takes. */
const MAX_DIGITS = 4;

/**
 * The screen number being typed ("1", "2", Enter goes to screen 12).
 *
 * @public
 */
export class NumberEntry {
  #digits = '';

  /** Whether digits are waiting for Enter. */
  get typing(): boolean {
    return this.#digits !== '';
  }

  /** The digits typed so far. */
  get text(): string {
    return this.#digits;
  }

  /** Add a digit (the number stops growing at four). */
  push(digit: string): void {
    if (this.#digits.length < MAX_DIGITS) this.#digits += digit;
  }

  /** Take the last digit back. */
  erase(): void {
    this.#digits = this.#digits.slice(0, -1);
  }

  /** Drop what was typed. */
  clear(): void {
    this.#digits = '';
  }

  /** The number typed (1 for the first screen) and the entry cleared; nothing when no digit was typed or the number is 0. */
  take(): number | undefined {
    const number = Number(this.#digits);
    this.#digits = '';
    return Number.isInteger(number) && number >= 1 ? number : undefined;
  }
}
