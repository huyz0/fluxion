// Deterministic port implementations for tests (testing.md T0: fakes for ports; NFR-REL-005).
import { err, ok, type Result } from '@fluxion/schema';
import type { CoreError } from '../errors.js';
import type { Clock, FileIO, FontSpec, Logger, LogLevel, TextMeasurer, TextMetrics } from '../ports/ports.js';

/**
 * A clock that moves only when told: `advance(ms)` runs the frames due.
 *
 * @public
 */
export class VirtualClock implements Clock {
  #time: number;
  #frames = new Map<number, (time: number) => void>();
  #nextId = 0;

  constructor(start = 0) {
    this.#time = start;
  }

  /** The time now, in ms. */
  now(): number {
    return this.#time;
  }

  /** Schedule `callback` for the next `advance`; returns the way to cancel it. */
  frame(callback: (time: number) => void): () => void {
    // tzap disable next-line UpdateOperator: counting down also gives each frame a distinct id, and frames run in insertion order either way
    const id = this.#nextId++;
    this.#frames.set(id, callback);
    return () => {
      this.#frames.delete(id);
    };
  }

  /** Move time forward by `ms` and run the frames scheduled before this call, in order. */
  advance(ms: number): void {
    this.#time += ms;
    const due = [...this.#frames];
    this.#frames.clear();
    for (const [, callback] of due) callback(this.#time);
  }
}

/**
 * A text measurer with fixed metrics: every character is `advance` em wide, lines are
 * `lineHeight` em tall (1.2 default), ascent 0.8 em and descent 0.2 em.
 *
 * @public
 */
export class FixedTextMeasurer implements TextMeasurer {
  readonly #advance: number;

  constructor(advance = 0.6) {
    this.#advance = advance;
  }

  /** The fixed metrics of `text` in `font`. */
  measure(text: string, font: FontSpec): TextMetrics {
    const lines = text.split('\n');
    const widest = Math.max(...lines.map((line) => [...line].length));
    return {
      width: widest * this.#advance * font.size,
      height: lines.length * (font.lineHeight ?? 1.2) * font.size,
      ascent: 0.8 * font.size,
      descent: 0.2 * font.size,
    };
  }
}

/**
 * A file port over a map; `files` exposes what was written.
 *
 * @public
 */
export class MemoryFileIO implements FileIO {
  /** What was written, by path. */
  readonly files: Map<string, Uint8Array> = new Map();

  /** The bytes at `path`, or FILE_NOT_FOUND. */
  async read(path: string): Promise<Result<Uint8Array, CoreError>> {
    const bytes = this.files.get(path);
    return bytes ? ok(bytes.slice()) : err({ code: 'FILE_NOT_FOUND', message: `no file at ${path}` });
  }

  /** Keep a copy of `bytes` at `path`. */
  async write(path: string, bytes: Uint8Array): Promise<Result<void, CoreError>> {
    this.files.set(path, bytes.slice());
    return ok(undefined);
  }
}

/**
 * One entry recorded by the capturing logger.
 *
 * @public
 */
export type LogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
};

/**
 * A logger that keeps every entry in `entries`.
 *
 * @public
 */
export class CaptureLogger implements Logger {
  /** Every entry logged, in order. */
  readonly entries: LogEntry[] = [];

  /** Record an entry. */
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.entries.push(fields === undefined ? { level, message } : { level, message, fields });
  }
}
