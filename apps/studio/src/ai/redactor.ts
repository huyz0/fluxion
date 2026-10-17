// Keeping keys out of every artifact (NFR-SEC-004, ADR-0041): the redactor replaces the exact values of the keys the studio holds, whatever
// their shape, and a second layer catches key-shaped text that was never registered.
import type { LogEntry } from '@fluxion/core';

/** What a redacted key is replaced by. */
export const REDACTED = '[redacted-key]';

/** Values shorter than this are not registered: they would mangle ordinary text and are no key. */
const MIN_KEY_LENGTH = 8;

/** Key-shaped text: provider prefixes, and a long token after `key`, `token` or `authorization`. */
const SHAPES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(?<=(?:key|token|authorization)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)[A-Za-z0-9_-]{24,}/gi,
];

/** Whether `text` holds something shaped like a provider key. */
export function looksLikeKey(text: string): boolean {
  return SHAPES.some((shape) => new RegExp(shape.source, shape.flags.replace('g', '')).test(text));
}

/**
 * The keys the studio holds, and the filter that removes them from text.
 *
 * @public
 */
export type Redactor = {
  /** Remembers `value` so that any text holding it is redacted. */
  register(value: string): void;
  /** Forgets every registered value. */
  clear(): void;
  /** `text` with every registered value and every key-shaped string replaced. */
  redact(text: string): string;
};

/** A redactor with no values registered. */
export function createRedactor(): Redactor {
  const values = new Set<string>();
  return {
    register: (value) => {
      if (value.length >= MIN_KEY_LENGTH) values.add(value);
    },
    clear: () => values.clear(),
    redact: (text) => {
      let out = text;
      for (const v of [...values].sort((a, b) => b.length - a.length)) out = out.split(v).join(REDACTED);
      for (const shape of SHAPES) out = out.replace(shape, REDACTED);
      return out;
    },
  };
}

/** The studio's redactor: the key store registers into it, the logger and the diagnostic report read from it. */
export const studioRedactor: Redactor = createRedactor();

const MAX_DEPTH = 4;

/** `value` with every string redacted; an Error becomes its name and redacted message, and nesting past a few levels is dropped. */
function redactValue(value: unknown, redactor: Redactor, depth: number): unknown {
  if (typeof value === 'string') return redactor.redact(value);
  if (value instanceof Error) return { name: value.name, message: redactor.redact(value.message) };
  if (depth >= MAX_DEPTH || typeof value !== 'object' || value === null) return typeof value === 'object' && value !== null ? '[object]' : value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, redactor, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactor.redact(k), redactValue(v, redactor, depth + 1)]));
}

/** A log entry with no key in its message or fields. */
export function redactEntry(entry: LogEntry, redactor: Redactor): LogEntry {
  return { ...entry, message: redactor.redact(entry.message), fields: redactValue(entry.fields, redactor, 0) as LogEntry['fields'] };
}
