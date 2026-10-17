// The key store (FR-AI-007, NFR-SEC-004, ADR-0041): a provider key is kept in IndexedDB as written, or sealed with the person's passphrase
// (PBKDF2-SHA-256 into AES-GCM-256, a fresh salt per record and a fresh IV per encryption). The passphrase lives in memory for the session
// only. Every key that passes through is registered with the redactor.
import type { KeyRecords, SealedKey } from './key-records.js';
import type { Redactor } from './redactor.js';

/** PBKDF2 rounds for new records; each record stores its own count so the default can be raised later. */
export const DEFAULT_ITERATIONS = 600_000;

/** Why a key could not be read. */
export type KeyStoreErrorCode = 'locked' | 'wrong-passphrase';

/** A key that cannot be read; the message names the cause and never a key. */
export class KeyStoreError extends Error {
  /** What went wrong. */
  readonly code: KeyStoreErrorCode;
  constructor(code: KeyStoreErrorCode) {
    super(code === 'locked' ? 'the key is sealed: enter the passphrase' : 'the passphrase does not open the key');
    this.name = 'KeyStoreError';
    this.code = code;
  }
}

/** The Web Crypto parts the store uses. */
export type CryptoLike = Pick<Crypto, 'subtle' | 'getRandomValues'>;

/** The key store. */
export type KeyStore = {
  /** Keeps `value` for `provider`; sealed when a passphrase is set. */
  set(provider: string, value: string): Promise<void>;
  /** The key for `provider`, or undefined; throws `KeyStoreError` when it is sealed and the passphrase is missing or wrong. */
  get(provider: string): Promise<string | undefined>;
  /** Forgets one key. */
  remove(provider: string): Promise<void>;
  /** Forgets every key and the passphrase. */
  clear(): Promise<void>;
  /** The providers that have a key. */
  providers(): Promise<readonly string[]>;
  /** Holds `passphrase` in memory so new keys are sealed and sealed keys open. */
  unlock(passphrase: string): void;
  /** Drops the passphrase from memory. */
  lock(): void;
};

/** What the store is built from. */
export type KeyStoreInput = {
  readonly records: KeyRecords;
  readonly crypto: CryptoLike;
  readonly redactor: Redactor;
  /** PBKDF2 rounds for new sealed records. */
  readonly iterations?: number;
};

const utf8 = new TextEncoder();

async function derive(crypto: CryptoLike, passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function seal(input: KeyStoreInput, passphrase: string, provider: string, value: string): Promise<SealedKey> {
  const { crypto } = input;
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(crypto, passphrase, salt, iterations);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, utf8.encode(value));
  return { provider, iterations, salt, iv, ciphertext: new Uint8Array(sealed) };
}

async function open(crypto: CryptoLike, passphrase: string, record: SealedKey): Promise<string> {
  try {
    const key = await derive(crypto, passphrase, record.salt, record.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as BufferSource }, key, record.ciphertext as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new KeyStoreError('wrong-passphrase');
  }
}

/** A key store over `input.records`. */
export function createKeyStore(input: KeyStoreInput): KeyStore {
  const { records, redactor } = input;
  let passphrase: string | undefined;
  return {
    set: async (provider, value) => {
      redactor.register(value);
      await records.put(passphrase === undefined ? { provider, value } : await seal(input, passphrase, provider, value));
    },
    get: async (provider) => {
      const record = await records.get(provider);
      if (record === undefined) return undefined;
      if ('value' in record) {
        redactor.register(record.value);
        return record.value;
      }
      if (passphrase === undefined) throw new KeyStoreError('locked');
      const value = await open(input.crypto, passphrase, record);
      redactor.register(value);
      return value;
    },
    remove: (provider) => records.delete(provider),
    clear: async () => {
      passphrase = undefined;
      await records.clear();
    },
    providers: () => records.list(),
    unlock: (p) => {
      passphrase = p;
    },
    lock: () => {
      passphrase = undefined;
    },
  };
}
