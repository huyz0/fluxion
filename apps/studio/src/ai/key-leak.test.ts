import type { ConsoleLike } from '@fluxion/core';
import { sha256Hex, writeFluxHtml } from '@fluxion/format';
import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedProblems, studioLogger } from '../dev-logger.js';
import { diagnosticReport } from '../diagnostic-report.js';
import { fileBytes, openFileBytes } from '../file-session.js';
import { memoryKeyRecords } from './key-records.js';
import { createKeyStore } from './key-store.js';
import { REDACTED, studioRedactor } from './redactor.js';

// NFR-SEC-004, ADR-0041: a key the studio holds, with a provider prefix or none, is in no saved file, no log line and no diagnostic report.
const PREFIXED = 'sk-ant-api03-Zk3Q9xT7mB2vLpR8sD4fG6hJ1nC5wY0a';
const PLAIN = 'k9x4f7a21c0b83de5961a7f4c2e8d0b3';
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };

afterEach(() => studioRedactor.clear());

async function holdBoth() {
  const store = createKeyStore({ records: memoryKeyRecords(), crypto, redactor: studioRedactor });
  await store.set('anthropic', PREFIXED);
  await store.set('local', PLAIN);
  return store;
}

function recorder() {
  const written: string[] = [];
  const at = (text: unknown) => void written.push(String(text));
  const target: ConsoleLike = { debug: at, info: at, warn: at, error: at };
  return { written, target };
}

describe('no key leaks (NFR-SEC-004, ADR-0041)', () => {
  it('NFR-SEC-004: log lines, their fields and thrown errors hold no registered key, with or without a provider prefix', async () => {
    await holdBoth();
    const sink = recorder();
    const log = studioLogger('?level=debug', sink.target).child('studio');
    log.log('error', `request failed with ${PREFIXED}`, { header: `Bearer ${PLAIN}`, nested: { list: [PLAIN] }, cause: new Error(`bad ${PREFIXED}`) });
    log.log('warn', `plain ${PLAIN}`);
    const everything = JSON.stringify([sink.written, loggedProblems()]);
    expect(everything).not.toContain(PREFIXED);
    expect(everything).not.toContain(PLAIN);
    expect(everything).toContain(REDACTED);
  });

  it('NFR-SEC-004: a key that was never registered is caught by its shape in a log line', () => {
    const sink = recorder();
    studioLogger('', sink.target).log('error', `rejected sk-ant-api03-NeverRegistered1234567890`);
    expect(sink.written.join('\n')).not.toContain('NeverRegistered');
  });

  it('NFR-SEC-004: the diagnostic report holds no key even in its free-form parts', async () => {
    await holdBoth();
    const doc = documentBuilder({ seed: 5, title: 'Deck' });
    doc.screen({ name: 's' });
    const report = diagnosticReport({
      versions: { studio: `1.0 ${PLAIN}` },
      records: doc.build().records,
      entries: [{ level: 'error', namespace: 'studio', message: PREFIXED, fields: {} }],
      userAgent: `agent ${PREFIXED} ${PLAIN}`,
    });
    expect(report).not.toContain(PREFIXED);
    expect(report).not.toContain(PLAIN);
    expect(report).toContain('"records"');
  });

  it('NFR-SEC-004: the .flux, its .flux.html and its document JSON written while keys are held hold no key', async () => {
    await holdBoth();
    const b = documentBuilder({ seed: 6, title: 'Deck' });
    b.rect(b.screen({ name: 'one' }), { x: 0, y: 0, w: 10, h: 10 });
    const saved = await fileBytes({ file: undefined, document: b.build(), bytesOf: () => Promise.resolve(undefined), hasher, appVersion: '1.0.0' });
    if (!saved.ok) throw new Error(saved.error);
    const opened = await openFileBytes('deck.flux', saved.value.bytes, hasher);
    if (!opened.ok) throw new Error(opened.error);
    const html = await writeFluxHtml({ flux: saved.value.bytes, playerScript: '/* player */', title: 'Deck', hasher });
    if (!html.ok) throw new Error(JSON.stringify(html.error));
    const artifacts = [new TextDecoder('latin1').decode(saved.value.bytes), serializeDocument(opened.value.document), html.value];
    for (const text of artifacts) {
      expect(text).not.toContain(PREFIXED);
      expect(text).not.toContain(PLAIN);
    }
  });
});
