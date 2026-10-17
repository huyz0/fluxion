import { describe, expect, it } from 'vitest';
import { memoryKeyRecords } from './key-records.js';
import { createKeyStore, DEFAULT_ITERATIONS, KeyStoreError } from './key-store.js';
import { createRedactor, looksLikeKey, REDACTED } from './redactor.js';

const KEY = 'k9x4f7a21c0b83de5961a7f4c2e8d0b3';

function fresh(iterations = 1000) {
  const records = memoryKeyRecords();
  const redactor = createRedactor();
  return { records, redactor, store: createKeyStore({ records, crypto, redactor, iterations }) };
}

describe('the key store (FR-AI-007, NFR-SEC-004, ADR-0041)', () => {
  it('FR-AI-007: without a passphrase a key round-trips as written, and remove and clear forget it', async () => {
    const { store, records } = fresh();
    await store.set('anthropic', KEY);
    expect(await store.get('anthropic')).toBe(KEY);
    expect(await records.get('anthropic')).toEqual({ provider: 'anthropic', value: KEY });
    expect(await store.providers()).toEqual(['anthropic']);
    await store.remove('anthropic');
    expect(await store.get('anthropic')).toBeUndefined();
    await store.set('openai', KEY);
    await store.clear();
    expect(await store.providers()).toEqual([]);
  });

  it('NFR-SEC-004: with a passphrase the stored record holds no key, carries its own salt, iterations and IV, and opens with the passphrase', async () => {
    const { store, records } = fresh(1234);
    store.unlock('correct horse');
    await store.set('openai', KEY);
    const record = await records.get('openai');
    expect(JSON.stringify(record)).not.toContain(KEY);
    expect(record).toMatchObject({ provider: 'openai', iterations: 1234 });
    expect(record).not.toHaveProperty('value');
    store.lock();
    await expect(store.get('openai')).rejects.toMatchObject({ code: 'locked' });
    store.unlock('correct horse');
    expect(await store.get('openai')).toBe(KEY);
  });

  it('NFR-SEC-004: a wrong passphrase is a KeyStoreError that names no key', async () => {
    const { store } = fresh();
    store.unlock('right');
    await store.set('openai', KEY);
    store.unlock('wrong');
    const e = await store.get('openai').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KeyStoreError);
    expect((e as KeyStoreError).code).toBe('wrong-passphrase');
    expect((e as KeyStoreError).message).not.toContain(KEY);
  });

  it('NFR-SEC-004: every encryption draws a fresh salt and IV, so re-setting a key never reuses one', async () => {
    const { store, records } = fresh();
    store.unlock('p');
    await store.set('a', KEY);
    const first = (await records.get('a')) as { salt: Uint8Array; iv: Uint8Array };
    await store.set('a', KEY);
    const second = (await records.get('a')) as { salt: Uint8Array; iv: Uint8Array };
    expect(Array.from(second.iv)).not.toEqual(Array.from(first.iv));
    expect(Array.from(second.salt)).not.toEqual(Array.from(first.salt));
    expect(first.salt.length).toBe(16);
    expect(first.iv.length).toBe(12);
  });

  it('NFR-SEC-004: new records use 600 000 PBKDF2 rounds unless told otherwise', () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
  });

  it('NFR-SEC-004: a key that is set or read is registered with the redactor, a clear forgets the passphrase', async () => {
    const { store, redactor } = fresh();
    await store.set('local', KEY);
    expect(redactor.redact(`header: ${KEY}`)).toBe(`header: ${REDACTED}`);
    store.unlock('p');
    await store.clear();
    await store.set('x', 'plainvalue-without-prefix-1');
    // clear dropped the passphrase, so the new key is stored as written
    expect(await store.get('x')).toBe('plainvalue-without-prefix-1');
  });
});

describe('the redactor (NFR-SEC-004, ADR-0041)', () => {
  it('NFR-SEC-004: a registered value is replaced wherever it appears, whatever its shape', () => {
    const r = createRedactor();
    r.register(KEY);
    expect(r.redact(`a ${KEY} b ${KEY}`)).toBe(`a ${REDACTED} b ${REDACTED}`);
    expect(r.redact('nothing here')).toBe('nothing here');
    r.clear();
    expect(r.redact(KEY)).toBe(KEY);
  });

  it('NFR-SEC-004: values too short to be a key are not registered, so ordinary text is not mangled', () => {
    const r = createRedactor();
    r.register('abc');
    expect(r.redact('abc def')).toBe('abc def');
  });

  it('NFR-SEC-004: key-shaped text that was never registered is caught by prefix and by what follows key, token or authorization', () => {
    const r = createRedactor();
    expect(r.redact('x sk-ant-api03-AbCdEf123456 y')).toBe(`x ${REDACTED} y`);
    expect(r.redact('sk-proj-AbCdEf1234567890abcd')).toBe(REDACTED);
    expect(r.redact('authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe(`authorization: Bearer ${REDACTED}`);
    expect(r.redact('{"api_key":"abcdefghijklmnopqrstuvwxyz0123"}')).toContain(REDACTED);
    expect(looksLikeKey('sk-ant-api03-AbCdEf123456')).toBe(true);
    expect(looksLikeKey('a sentence about keys and tokens')).toBe(false);
  });
});
