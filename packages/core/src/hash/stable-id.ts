// Stable ids for compiled records (ADR-0031, FR-DSL-002): `base62(hash128(salt + ':' + key))`, 22 characters. The same source, salt and
// key give the same id on every host, with no clock and no randomness (NFR-REL-005).
import type { SyncHash128 } from '../ports/ports.js';
import { sha256Bytes } from './sha256.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const WIDTH = 22; // 62^22 > 2^128

/** The UTF-8 bytes of `text` (a lone surrogate encodes as U+FFFD; `TextEncoder` is not in this package's `lib`). */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0) ?? 0xfffd;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/**
 * The default {@link SyncHash128}: the first 16 bytes of the SHA-256 of the UTF-8 text (ADR-0031).
 *
 * @public
 */
export const sha256Hash128: SyncHash128 = { hash128: (text) => sha256Bytes(utf8(text)).slice(0, 16) };

/**
 * `bytes` read as one big-endian number and written in base 62 (`0-9A-Za-z`), zero-padded to 22 characters (16 bytes always fit).
 *
 * @public
 */
export function base62(bytes: Uint8Array): string {
  const digits = Array.from(bytes);
  let out = '';
  // long division by 62, most significant byte first, until the number is 0
  while (digits.some((d) => d !== 0)) {
    let rest = 0;
    for (let i = 0; i < digits.length; i++) {
      const acc = rest * 256 + (digits[i] as number);
      digits[i] = Math.floor(acc / 62);
      rest = acc % 62;
    }
    out = ALPHABET[rest] + out;
  }
  return out.padStart(WIDTH, '0');
}

/**
 * The stable id of the record named `key` in the document salted with `salt` (ADR-0031).
 *
 * @public
 */
export function stableId(hasher: SyncHash128, salt: string, key: string): string {
  return base62(hasher.hash128(`${salt}:${key}`));
}

/**
 * The salt of a compile (ADR-0031): the base document's `source.salt` when it has one, so a recompile keeps the ids of what did not
 * change; else the salt the compile was given (a host making a new document passes a random one); else the empty string.
 *
 * @public
 */
export function resolveSalt(base: { readonly source?: { readonly salt?: unknown } } | undefined, given?: string): string {
  const kept = base?.source?.salt;
  return typeof kept === 'string' ? kept : (given ?? '');
}

/**
 * What names an edge's record: its screen, its ends' slugs and its op, and which repeat of the same edge on that screen it is (from 1).
 *
 * @public
 */
export type EdgeKey = {
  /** The screen's id. */
  readonly screen: string;
  /** The source end's slug. */
  readonly from: string;
  /** The edge op (`->`, `<-`, `<->`, `--`, `~>`). */
  readonly op: string;
  /** The target end's slug. */
  readonly to: string;
  /** Which repeat of the same edge on the screen (1 when omitted). */
  readonly n?: number;
};

/**
 * The keys of the records a FluxScript compile makes (ADR-0031). The n-th repeat of the same edge on a screen (n ≥ 2) adds `:<n>`.
 *
 * @public
 */
export const idKeys: {
  /** The document record's key. */
  readonly document: () => string;
  /** A theme's key, by its name. */
  readonly theme: (name: string) => string;
  /** A screen's key, by its id. */
  readonly screen: (id: string) => string;
  /** A node's or group's key, by its slug. */
  readonly node: (slug: string) => string;
  /** An edge's key. */
  readonly edge: (e: EdgeKey) => string;
} = {
  document: () => 'document',
  theme: (name) => `theme:${name}`,
  screen: (id) => `screen:${id}`,
  node: (slug) => `node:${slug}`,
  edge: (e) => `edge:${e.screen}:${e.from}:${e.op}:${e.to}${(e.n ?? 1) >= 2 ? `:${e.n}` : ''}`,
};
