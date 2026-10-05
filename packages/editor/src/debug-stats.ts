// What the debug overlay shows (NFR-OBS-001): counters (renders), timings (a route took so long) and the frame rate from frame timestamps. Pure: the overlay reads the
// clock and feeds it in, so these are tested without a browser.

/** The timings of one kind of work. */
export type TimingStat = {
  /** How many times it ran. */
  readonly count: number;
  /** The mean duration, ms. */
  readonly mean: number;
  /** The longest, ms. */
  readonly max: number;
};

/** A reading of the stats at one moment. */
export type DebugSnapshot = {
  /** Counters by name. */
  readonly counts: { readonly [name: string]: number };
  /** Timings by name. */
  readonly timings: { readonly [name: string]: TimingStat };
};

/** The counters and timings the editor and its views report. */
export class DebugStats {
  readonly #counts = new Map<string, number>();
  readonly #timings = new Map<string, { count: number; total: number; max: number }>();

  /** Add one to the counter `name`. */
  count(name: string): void {
    this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1);
  }

  /** Record that `name` took `ms`. */
  time(name: string, ms: number): void {
    const t = this.#timings.get(name) ?? { count: 0, total: 0, max: 0 };
    t.count += 1;
    t.total += ms;
    t.max = Math.max(t.max, ms);
    this.#timings.set(name, t);
  }

  /** Everything recorded so far. */
  snapshot(): DebugSnapshot {
    return {
      counts: Object.fromEntries(this.#counts),
      timings: Object.fromEntries([...this.#timings].map(([name, t]) => [name, { count: t.count, mean: t.total / t.count, max: t.max }])),
    };
  }

  /** Forget everything. */
  reset(): void {
    this.#counts.clear();
    this.#timings.clear();
  }
}

/** Frames per second from the timestamps (ms) of consecutive frames: the frames in the span they cover; 0 for fewer than two. */
export function fpsOf(frames: readonly number[]): number {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined || frames.length < 2 || last <= first) return 0;
  return ((frames.length - 1) * 1000) / (last - first);
}
