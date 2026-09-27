// Fractional-index keys (FR-DOC-010, ADR-0012). A key is an integer part whose head character fixes
// its length (a..z: 1..26 digits, Z..A: 1..26 digits for negatives) plus a base-62 fraction that
// never ends in '0'. Digits are in ASCII order, so keys compare as plain strings.
import type { FluxError } from './errors.js';
import { err, ok, type Result } from './result.js';

/**
 * A fractional-index key (`"a0"`, `"a0V"`); order is plain code-unit string order.
 *
 * @public
 */
export type IndexKey = string & {
  /** Compile-time brand only; never present at runtime. */
  readonly __brand: 'IndexKey';
};

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;
const FIRST = 'a0';

const invalid = (key: string): FluxError => ({ code: 'INDEX_INVALID', message: `invalid fractional-index key ${JSON.stringify(key)}` });

/** Length of the integer part announced by its head character, or 0 when the head is invalid. */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return 0;
}

const isDigits = (s: string): boolean => [...s].every((c) => DIGITS.includes(c));

/**
 * Whether `key` is a well-formed fractional-index key.
 *
 * @public
 */
export function isIndexKey(key: unknown): key is IndexKey {
  if (typeof key !== 'string' || key.length === 0) return false;
  const n = integerLength(key.charAt(0));
  if (n === 0 || key.length < n || !isDigits(key.slice(1))) return false;
  // the smallest integer alone has no key before it; with a fraction it is a valid key
  if (key === SMALLEST_INTEGER) return false;
  return !key.slice(n).endsWith('0');
}

/**
 * Compare two keys: negative, zero or positive, by code-unit order (never locale order).
 *
 * @public
 */
export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const digitAt = (s: string, i: number): number => DIGITS.indexOf(s.charAt(i));

/** A fraction strictly between fractions `a` and `b` (`null` = 1); `a < b`, no trailing zeros. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || '0') === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const lo = a ? digitAt(a, 0) : 0;
  const hi = b !== null ? digitAt(b, 0) : BASE;
  if (hi - lo > 1) return DIGITS.charAt(Math.round((lo + hi) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(lo) + midpoint(a.slice(1), null);
}

/** The next integer part, or null past the largest (`z` + 26 × `z`). */
function incrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digits = [...x.slice(1)];
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '0') + 1;
    if (d < BASE) {
      digits[i] = DIGITS.charAt(d);
      return head + digits.join('');
    }
    digits[i] = '0';
  }
  if (head === 'Z') return FIRST;
  if (head === 'z') return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > 'a') digits.push('0');
  else digits.pop();
  return next + digits.join('');
}

/** The previous integer part, or null below the smallest. */
function decrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digits = [...x.slice(1)];
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '0') - 1;
    if (d >= 0) {
      digits[i] = DIGITS.charAt(d);
      return head + digits.join('');
    }
    digits[i] = DIGITS.charAt(BASE - 1);
  }
  if (head === 'a') return `Z${DIGITS.charAt(BASE - 1)}`;
  if (head === 'A') return null;
  const prev = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prev < 'Z') digits.push(DIGITS.charAt(BASE - 1));
  else digits.pop();
  return prev + digits.join('');
}

const split = (key: string): [string, string] => {
  const n = integerLength(key.charAt(0));
  return [key.slice(0, n), key.slice(n)];
};

function before(b: string): IndexKey {
  const [int, frac] = split(b);
  if (int === SMALLEST_INTEGER) return (int + midpoint('', frac)) as IndexKey;
  if (frac) return int as IndexKey;
  // int > SMALLEST_INTEGER here, so a previous integer exists; the smallest alone is not a key
  const prev = decrementInteger(int) ?? SMALLEST_INTEGER;
  return (prev === SMALLEST_INTEGER ? prev + midpoint('', null) : prev) as IndexKey;
}

function after(a: string): IndexKey {
  const [int, frac] = split(a);
  // past the largest integer, keys grow a fraction instead: the key space never runs out
  const next = incrementInteger(int);
  return (next === null ? int + midpoint(frac, null) : next) as IndexKey;
}

function between(a: string, b: string): IndexKey {
  const [intA, fracA] = split(a);
  const [intB, fracB] = split(b);
  if (intA === intB) return (intA + midpoint(fracA, fracB)) as IndexKey;
  const next = incrementInteger(intA);
  // intA < intB, so an increment exists and is at most intB
  if (next !== null && next < b) return next as IndexKey;
  return (intA + midpoint(fracA, null)) as IndexKey;
}

/**
 * A key strictly between `a` and `b` (`null` = open end; both null gives the first key `a0`).
 *
 * @returns `INDEX_INVALID` for a malformed key, `INDEX_ORDER` unless `a < b`
 * @public
 */
export function keyBetween(a: string | null, b: string | null): Result<IndexKey> {
  if (a !== null && !isIndexKey(a)) return err(invalid(a));
  if (b !== null && !isIndexKey(b)) return err(invalid(b));
  if (a !== null && b !== null && a >= b) return err({ code: 'INDEX_ORDER', message: `${a} is not before ${b}` });
  if (a === null) return ok(b === null ? (FIRST as IndexKey) : before(b));
  if (b === null) return ok(after(a));
  return ok(between(a, b));
}

/**
 * `n` strictly increasing keys between `a` and `b`, spread by bisection.
 *
 * @public
 */
export function nKeysBetween(a: string | null, b: string | null, n: number): Result<IndexKey[]> {
  if (!Number.isInteger(n) || n < 0) return err({ code: 'INDEX_INVALID', message: `key count ${n} is not a non-negative integer` });
  if (n === 0) {
    const check = keyBetween(a, b);
    return check.ok ? ok([]) : check;
  }
  const first = keyBetween(a, b);
  if (!first.ok) return first;
  if (n === 1) return ok([first.value]);
  if (b === null || a === null) return sequential(a, b, n);
  const mid = Math.floor(n / 2);
  const c = first.value;
  const left = nKeysBetween(a, c, mid);
  const right = nKeysBetween(c, b, n - mid - 1);
  if (!left.ok) return left;
  if (!right.ok) return right;
  return ok([...left.value, c, ...right.value]);
}

/** Keys walking away from the one bound given (appending after `a` or prepending before `b`). */
function sequential(a: string | null, b: string | null, n: number): Result<IndexKey[]> {
  const keys: IndexKey[] = [];
  let cursor = b === null ? a : b;
  for (let i = 0; i < n; i++) {
    const next = b === null ? keyBetween(cursor, null) : keyBetween(null, cursor);
    if (!next.ok) return next;
    keys.push(next.value);
    cursor = next.value;
  }
  return ok(b === null ? keys : keys.reverse());
}
