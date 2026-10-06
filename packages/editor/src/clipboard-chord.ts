// The clipboard chords the browser does not answer (FR-EDT-007, NFR-PORT-001, M11.59). The editor copies and pastes on the browser's `copy`, `cut` and `paste` events, which
// Ctrl/Cmd+C, X and V raise (use-system-clipboard.ts). Some engines raise none of them unless an editable field has the focus: WebKit 26.5 (Playwright 1.62.1) does not, on
// the canvas, with or without a selection (scripts/ci/clipboard-events-probe.mjs). So a chord that no event answers within a short wait is done by the same async path the menu
// commands use. Pure: the clock is injected.

/** What a clipboard chord asks for. */
export type ClipboardAction = 'copy' | 'cut' | 'paste';

/** How long a chord waits for the browser's event before the editor does it itself, ms. The event is the default action of the key and fires within the same task. */
export const CHORD_WAIT_MS = 50;

/** The parts of a key event that name a chord. */
export type ChordKey = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key' | 'repeat'>;

const ACTIONS: Readonly<Record<string, ClipboardAction>> = { c: 'copy', x: 'cut', v: 'paste' };

/** The action of Ctrl/Cmd+C, X or V (no shift or alt, not an auto-repeat); undefined for any other key. */
export function chordAction(e: ChordKey): ClipboardAction | undefined {
  if (e.repeat || e.shiftKey || e.altKey || !(e.ctrlKey || e.metaKey)) return undefined;
  return ACTIONS[e.key.toLowerCase()];
}

/** A clock: `set` runs `fn` once after `ms` and returns a handle `clear` cancels. */
export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

/** What the hook feeds and what it does when nothing answered. */
export type ChordFallback = {
  /** A chord was pressed: if no event answers it in time, `act` is called with its action. A chord still waiting when the next is pressed is done first, so no press is lost. */
  pressed(action: ClipboardAction): void;
  /** The browser raised a clipboard event: it carries the chord, so nothing is done on top of it. */
  answered(): void;
  /** Forget a waiting chord (the editor goes away). */
  cancel(): void;
};

/** The fallback over `timers`, calling `act` for a chord nothing answered. */
export function chordFallback(timers: Timers, act: (action: ClipboardAction) => void): ChordFallback {
  let waiting: { readonly action: ClipboardAction; readonly handle: unknown } | undefined;
  const cancel = () => {
    if (waiting !== undefined) timers.clear(waiting.handle);
    waiting = undefined;
  };
  return {
    pressed(action) {
      // the one before got no answer and another key came: it is done now, in order
      const before = waiting?.action;
      cancel();
      if (before !== undefined) act(before);
      const handle = timers.set(() => {
        waiting = undefined;
        act(action);
      }, CHORD_WAIT_MS);
      waiting = { action, handle };
    },
    answered: cancel,
    cancel,
  };
}
