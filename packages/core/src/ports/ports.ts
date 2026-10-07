// Effects reach the pure core only through these ports (coding-typescript rule 16; 03-core-engine §7).
// Hosts inject browser or Node implementations; tests inject the fakes in @fluxion/core/testing.
import type { Result } from '@fluxion/schema';
import type { CoreError } from '../errors.js';

/**
 * Time and frame scheduling.
 *
 * @public
 */
export interface Clock {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  /** Run `callback` with the frame time at the next frame; returns a function that cancels it. */
  frame(callback: (time: number) => void): () => void;
}

/**
 * Font parameters a {@link TextMeasurer} needs.
 *
 * @public
 */
export type FontSpec = {
  /** Font family name. */
  readonly family: string;
  /** Font size in px. */
  readonly size: number;
  /** CSS font weight, 400 when omitted. */
  readonly weight?: number;
  /** Line height as a multiple of `size`, 1.2 when omitted. */
  readonly lineHeight?: number;
  /** CSS font style (`normal`, `italic`), `normal` when omitted. */
  readonly style?: string;
};

/**
 * Size of laid-out text in px.
 *
 * @public
 */
export type TextMetrics = {
  /** Width of the widest line. */
  readonly width: number;
  /** Height of all lines. */
  readonly height: number;
  /** Distance from the first line's top to its baseline. */
  readonly ascent: number;
  /** Distance from the last line's baseline to its bottom. */
  readonly descent: number;
};

/**
 * Measures text boxes (canvas in the browser, font files in Node).
 *
 * @public
 */
export interface TextMeasurer {
  /** Metrics of `text` (lines split at `\n`) set in `font`. */
  measure(text: string, font: FontSpec): TextMetrics;
}

/**
 * Reads and writes bytes by path (File System Access / OPFS, `node:fs`, memory).
 *
 * @public
 */
export interface FileIO {
  /** The bytes at `path`, or `FILE_NOT_FOUND` / `FILE_IO`. */
  read(path: string): Promise<Result<Uint8Array, CoreError>>;
  /** Store `bytes` at `path`, or `FILE_IO`. */
  write(path: string, bytes: Uint8Array): Promise<Result<void, CoreError>>;
}

/**
 * Content hashing.
 *
 * @public
 */
export interface Hasher {
  /** Lower-case hex SHA-256 of `bytes`. */
  sha256(bytes: Uint8Array): Promise<string>;
}

/**
 * A synchronous 128-bit hash for stable ids (ADR-0031): pure compiles cannot await {@link Hasher}.
 *
 * @public
 */
export interface SyncHash128 {
  /** 16 bytes hashed from the UTF-8 bytes of `text`. */
  hash128(text: string): Uint8Array;
}

/**
 * Severity of a {@link Logger} entry.
 *
 * @public
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logging.
 *
 * @public
 */
export interface Logger {
  /** Record `message` with optional structured `fields` at `level`. */
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void;
}
