import { afterEach, describe, expect, it } from 'vitest';
import { idbKeyRecords } from './key-records.js';
import { createKeyStore } from './key-store.js';
import { createRedactor } from './redactor.js';

const opened: { close(): void }[] = [];
let n = 0;
const fresh = () => {
  n += 1;
  const name = `fluxion-ai-test-${Date.now()}-${n}`;
  const records = idbKeyRecords(indexedDB, name);
  opened.push(records);
  return { records, name };
};
afterEach(() => {
  for (const r of opened.splice(0)) r.close();
});

describe('the IndexedDB key records (FR-AI-007, NFR-SEC-004, ADR-0041)', () => {
  it('FR-AI-007: keys round-trip through IndexedDB with and without a passphrase, from a second connection', async () => {
    const { records, name } = fresh();
    const store = createKeyStore({ records, crypto, redactor: createRedactor(), iterations: 1000 });
    await store.set('plain', 'plain-key-value-1234');
    store.unlock('pass');
    await store.set('sealed', 'sealed-key-value-5678');
    const again = idbKeyRecords(indexedDB, name);
    opened.push(again);
    const second = createKeyStore({ records: again, crypto, redactor: createRedactor() });
    expect([...(await second.providers())].sort()).toEqual(['plain', 'sealed']);
    expect(await second.get('plain')).toBe('plain-key-value-1234');
    await expect(second.get('sealed')).rejects.toMatchObject({ code: 'locked' });
    second.unlock('pass');
    expect(await second.get('sealed')).toBe('sealed-key-value-5678');
    await second.remove('plain');
    expect(await second.providers()).toEqual(['sealed']);
  });

  it('NFR-SEC-004: keys live in the database fluxion-ai only: localStorage, sessionStorage and cookies hold none', async () => {
    const { records } = fresh();
    const store = createKeyStore({ records, crypto, redactor: createRedactor(), iterations: 1000 });
    await store.set('p', 'secret-key-value-abcdef');
    const everything = JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie, location.href]);
    expect(everything).not.toContain('secret-key-value-abcdef');
  });
});
