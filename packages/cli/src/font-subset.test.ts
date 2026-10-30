import { readFileSync } from 'node:fs';
import { type FontJobWorker, loadFlux, sha256Hex, writeFlux } from '@fluxion/format';
import type { DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { cliSubsetDeps, subsetFlux, threadWorker } from './font-subset.js';

// The CLI's subset host (FR-AST-003, ADR-0051, M18.40): a worker that cannot start, fails or answers garbage keeps every font whole and the
// input's own bytes; a file that does not open is a one-line error.
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const FIRA = new Uint8Array(readFileSync(new URL('../../../fixtures/fonts/fira-sans-400.ttf', import.meta.url)));

async function flux(): Promise<Uint8Array> {
  const hash = sha256Hex(FIRA);
  const font = { family: 'Fira Sans', weight: 400, style: 'normal', source: 'google', license: 'OFL-1.1', copyright: 'Copyright 2012 Mozilla' };
  const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
  const records = {
    d: { id: 'd', type: 'document', title: 'Fonts' },
    s1: { id: 's1', type: 'screen', name: 'One', index: 'a0' },
    e1: { id: 'e1', type: 'element', kind: 'text', screenId: 's1', index: 'a0', transform: { x: 0, y: 0, w: 400, h: 60, rotation: 0 }, text },
    f1: { id: 'f1', type: 'asset', hash, mime: 'font/ttf', size: FIRA.length, name: 'FiraSans-Regular.ttf', font },
  };
  const document = { schemaVersion: '1.7', records } as unknown as DocumentFile;
  const written = await writeFlux({ document, assets: new Map([[hash, { bytes: FIRA, mime: 'font/ttf' }]]), appVersion: '1.0.0', hasher });
  if (!written.ok) throw new Error(written.error.reason);
  return written.value;
}

/** A worker that answers `answer` to any job. */
const answering = (answer: unknown) => (): FontJobWorker => {
  const worker: FontJobWorker = {
    onmessage: null,
    onerror: null,
    postMessage: () => queueMicrotask(() => worker.onmessage?.({ data: answer })),
    terminate: () => undefined,
  };
  return worker;
};

describe('the CLI font subset host (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: a worker that cannot start, answers garbage or is missing keeps the font whole and the input bytes', async () => {
    const input = await flux();
    const blocked = (): FontJobWorker => {
      throw new Error('no threads');
    };
    const missing = (): FontJobWorker => threadWorker(new URL('./no-such-worker.js', import.meta.url));
    for (const spawn of [blocked, answering({ nonsense: true }), missing]) {
      const done = await subsetFlux(input, cliSubsetDeps(hasher, spawn), hasher);
      if ('error' in done) throw new Error(done.error);
      expect(done.bytes).toBe(input);
      expect(done.fonts).toMatchObject([{ asset: 'f1', status: 'kept', reason: 'engine-failure', before: FIRA.length, after: FIRA.length }]);
    }
    const reopened = await loadFlux(input, { hasher });
    expect(reopened.ok && reopened.value.assets.has(sha256Hex(FIRA))).toBe(true);
  });

  it('FR-AST-003: bytes that are not a .flux are a one-line error', async () => {
    const done = await subsetFlux(new TextEncoder().encode('not a zip'), cliSubsetDeps(hasher), hasher);
    expect(done).toMatchObject({ error: expect.any(String) });
  });
});
