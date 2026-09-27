// Record IDs (FR-DOC-002, ADR-0012): 16 symbols of a URL-safe 64-symbol alphabet = 96 bits,
// drawn through the injected Random port so the pure core stays deterministic (NFR-REL-005).

/**
 * Source of randomness injected into pure code. `next()` returns a float in `[0, 1)`.
 *
 * @public
 */
export interface Random {
  /** A float in `[0, 1)`. */
  next(): number;
}

/**
 * A record identifier: URL-safe, unique within a document.
 *
 * @public
 */
export type RecordId = string & {
  /** Compile-time brand only; never present at runtime. */
  readonly __brand: 'RecordId';
};

/**
 * The 64 ID symbols, in the order `createId` maps random draws onto them.
 *
 * @public
 */
export const ID_ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Length of generated IDs (16 × 6 bits = 96 bits of entropy).
 *
 * @public
 */
export const ID_LENGTH: number = 16;

const GENERATED = /^[A-Za-z0-9_-]{16}$/;
// readable fixture and hand-written IDs (`doc`, `s1`) are valid record IDs too (ADR-0012)
const ACCEPTED = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Create a new record ID from `random`.
 *
 * @param random - the injected randomness; a seeded one yields the same IDs every run
 * @returns a 16-character ID over {@link ID_ALPHABET}
 * @public
 */
export function createId(random: Random): RecordId {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    // clamp: a faulty port returning 1 (or more) must not index past the alphabet
    const n = Math.min(ID_ALPHABET.length - 1, Math.max(0, Math.floor(random.next() * ID_ALPHABET.length)));
    id += ID_ALPHABET.charAt(n);
  }
  return id as RecordId;
}

/**
 * Whether `value` is an acceptable record ID (1–64 characters of {@link ID_ALPHABET}).
 *
 * @public
 */
export function isRecordId(value: unknown): value is RecordId {
  return typeof value === 'string' && ACCEPTED.test(value);
}

/**
 * Whether `value` has the exact shape `createId` produces (16 characters).
 *
 * @public
 */
export function isGeneratedId(value: unknown): value is RecordId {
  return typeof value === 'string' && GENERATED.test(value);
}

/**
 * A deterministic `Random` (mulberry32) for tests, builders and seeded generation. Not for
 * security-sensitive use.
 *
 * @param seed - any 32-bit integer; the same seed gives the same sequence
 * @public
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
