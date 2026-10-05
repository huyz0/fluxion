// The presentation controller (FR-PRS-002, FR-SCR-002): where a presentation is (a screen and how many of its build groups have played), and the moves
// that change it, with no view in it. The deck, the keys, the overview grid, the deep links and the web component all drive this one object. It
// reads the screens to present from its source on every move, so a hidden screen the source leaves out is never visited and a document that
// changes under it keeps it on a screen that exists. Pure: the only outside it knows is the clock it stamps its history with.
import type { Clock } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';

/**
 * Where a presentation is.
 *
 * @public
 */
export type Position = {
  /** The screen on show. */
  readonly screen: RecordId;
  /** How many of the screen's build groups have played: 0 shows the screen before any, the screen's group count shows it complete. */
  readonly group: number;
};

/**
 * A position the presentation was at, and when.
 *
 * @public
 */
export type Visit = Position & {
  /** The clock's reading when the presentation arrived there. */
  readonly at: number;
};

/**
 * What the controller presents.
 *
 * @public
 */
export interface DeckSource {
  /** The screens to present, in presentation order, hidden ones left out. */
  screens(): readonly RecordId[];
  /** How many build groups `screen` has; none (the default) shows the screen whole. */
  groups?(screen: RecordId): number;
}

/** The most positions the history keeps. */
const HISTORY_LIMIT = 200;

/**
 * Moves through a presentation: `next` and `prev` play a screen's build groups before leaving it, `first`, `last` and `goTo` jump, and `back` returns to the
 * position the presentation was at before the current one.
 *
 * @public
 */
export class PresentationController {
  readonly #source: DeckSource;
  readonly #clock: Clock;
  readonly #listeners = new Set<(position: Position | undefined) => void>();
  readonly #history: Visit[] = [];

  /** A controller over `source`, stamping its history with `clock`; it starts at the first screen. */
  constructor(source: DeckSource, clock: Clock) {
    this.#source = source;
    this.#clock = clock;
    this.first();
  }

  /** Where the presentation is now, or nothing when there is no screen to show. */
  position(): Position | undefined {
    const current = this.#history.at(-1);
    const screens = this.#source.screens();
    // the document changed under the presentation: stay on the screen if it is still one to present, else go to the first
    const screen = current !== undefined && screens.includes(current.screen) ? current.screen : screens[0];
    if (screen === undefined) return undefined;
    return { screen, group: current !== undefined && screen === current.screen ? Math.min(current.group, this.#count(screen)) : 0 };
  }

  /** The positions visited, oldest first (the last is the current one). */
  history(): readonly Visit[] {
    return this.#history.slice();
  }

  /** Call `listener` after every move; returns the way to stop. */
  subscribe(listener: (position: Position | undefined) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Play the next build group of the screen, or move to the next screen; false at the end. */
  next(): boolean {
    const at = this.position();
    if (at === undefined) return false;
    if (at.group < this.#count(at.screen)) return this.#arrive({ screen: at.screen, group: at.group + 1 });
    const screens = this.#source.screens();
    const following = screens[screens.indexOf(at.screen) + 1];
    return following === undefined ? false : this.#arrive({ screen: following, group: 0 });
  }

  /** Take back the last build group of the screen, or move to the previous screen shown complete; false at the start. */
  prev(): boolean {
    const at = this.position();
    if (at === undefined) return false;
    if (at.group > 0) return this.#arrive({ screen: at.screen, group: at.group - 1 });
    const screens = this.#source.screens();
    const before = screens[screens.indexOf(at.screen) - 1];
    return before === undefined ? false : this.#arrive({ screen: before, group: this.#count(before) });
  }

  /** The first screen, before any of its groups. */
  first(): boolean {
    const screen = this.#source.screens()[0];
    return screen === undefined ? false : this.#arrive({ screen, group: 0 });
  }

  /** The last screen, complete. */
  last(): boolean {
    const screen = this.#source.screens().at(-1);
    return screen === undefined ? false : this.#arrive({ screen, group: this.#count(screen) });
  }

  /** Go to `screen` after `group` of its groups (kept inside its count); false when the screen is not one to present (hidden or absent). */
  goTo(screen: RecordId, group = 0): boolean {
    if (!this.#source.screens().includes(screen)) return false;
    const wanted = Number.isFinite(group) ? Math.trunc(group) : 0;
    return this.#arrive({ screen, group: Math.min(Math.max(0, wanted), this.#count(screen)) });
  }

  /** Return to the position before the current one, which leaves the history; false when there is none (or it is no longer a screen to present). */
  back(): boolean {
    if (this.#history.length < 2) return false;
    const earlier = this.#history.at(-2) as Visit;
    if (!this.#source.screens().includes(earlier.screen)) return false;
    const left = this.position();
    this.#history.pop();
    // the entry under the one popped is the position returned to (its group may have shrunk with the document)
    const now = this.position();
    if (now !== undefined && (left === undefined || left.screen !== now.screen || left.group !== now.group)) this.#tell(now);
    return true;
  }

  #count(screen: RecordId): number {
    return Math.max(0, Math.trunc(this.#source.groups?.(screen) ?? 0));
  }

  /** Move to `to`: a position that is not the current one is recorded and told to the listeners; arriving where the presentation already is changes nothing. */
  #arrive(to: Position): boolean {
    const before = this.position();
    const changed = before === undefined || before.screen !== to.screen || before.group !== to.group;
    // the first position is recorded even though the presentation is already "there": the history starts with it
    if (changed || this.#history.length === 0) {
      this.#history.push({ ...to, at: this.#clock.now() });
      if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    }
    if (changed) this.#tell(to);
    return true;
  }

  #tell(position: Position): void {
    for (const listener of [...this.#listeners]) listener(position);
  }
}
