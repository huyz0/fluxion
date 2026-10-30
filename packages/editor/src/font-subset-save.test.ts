import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FONT_SUBSET_JOB_TIMEOUT_MS,
  FONT_SUBSET_POLICY,
  type FontJobScope,
  type FontJobWorker,
  type FontSubsetInput,
  type FontSubsetOutcome,
  glyphInventory,
  instantiateFontEngines,
  runFontSubsetJob,
  serveFontSubsetJob,
  subsetFontGaps,
  subsetFontsForSave,
  unicodeRangeOf,
  unicodeRangePairs,
  type WasmInstantiate,
} from '@fluxion/format';
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import { describe, expect, it, vi } from 'vitest';

const FIRA = new Uint8Array(readFileSync(new URL('../../../fixtures/fonts/fira-sans-400.ttf', import.meta.url)));
const ASSETS = new URL('../../format/assets/font-engine/', import.meta.url);
const MODULES = {
  harfbuzz: new Uint8Array(readFileSync(new URL('harfbuzz-subset.wasm', ASSETS))),
  codec: new Uint8Array(readFileSync(new URL('woff2-codec.wasm', ASSETS))),
};
const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256 = async (bytes: Uint8Array): Promise<string> => hex(bytes);
const instantiate: WasmInstantiate = async (bytes, imports) => (await WebAssembly.instantiate(bytes as BufferSource, imports as WebAssembly.Imports)).instance;
const engines = () => instantiateFontEngines(MODULES, { sha256, instantiate });

const font = (id: string, source: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'asset',
  hash: hex(FIRA),
  mime: 'font/ttf',
  size: FIRA.length,
  name: 'FiraSans-Regular.ttf',
  font: { family: 'Fira Sans', weight: 400, style: 'normal', source, license: 'OFL-1.1', copyright: 'Copyright 2012 Mozilla', metrics: { ascent: 0.935 } },
  ...extra,
});
const docOf = (text: string, ...fonts: { id: string }[]): DocumentFile =>
  ({
    schemaVersion: '1.7',
    records: Object.fromEntries(
      [
        { id: 'd', type: 'document', title: 'T' },
        { id: 's1', type: 'screen', name: 'S', index: 'a0' },
        { id: 'e1', type: 'element', kind: 'text', screenId: 's1', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
        ...fonts,
      ].map((r) => [r.id, r]),
    ),
  }) as unknown as DocumentFile;
const bytesOf = (hash: string) => (hash === hex(FIRA) ? FIRA : undefined);

describe('subset-on-save candidate (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: replaces eligible font records in a copy and never changes the live document', async () => {
    const doc = docOf('Hello', font('f1', 'bundled'), font('f2', 'upload'));
    const before = structuredClone(doc);
    const save = await subsetFontsForSave(doc, bytesOf, { engines, sha256 });
    expect(doc).toEqual(before);
    const [subset, kept] = [save.document.records['f1' as never] as unknown as { hash: string; font: unknown }, save.document.records['f2' as never]];
    const [line1, line2] = save.report;
    expect(line1).toMatchObject({ asset: 'f1', status: 'subset', before: FIRA.length });
    expect(line2).toMatchObject({ asset: 'f2', status: 'kept', reason: 'unverified-source', after: FIRA.length });
    const bytes = save.assets.get(subset.hash as string)?.bytes as Uint8Array;
    expect(hex(bytes)).toBe(subset.hash);
    expect(subset).toMatchObject({ mime: 'font/woff2', size: bytes.length, name: 'FiraSans-Regular.woff2' });
    expect(subset.font).toMatchObject({
      family: 'Fira Sans',
      license: 'OFL-1.1',
      copyright: 'Copyright 2012 Mozilla',
      metrics: { ascent: 0.935 },
      subset: { source: hex(FIRA), sourceSize: FIRA.length, policy: FONT_SUBSET_POLICY, unicodes: 'U+48,U+65,U+6C,U+6F' },
    });
    // a kept font and every other record are the very same objects
    expect(kept).toBe(doc.records['f2' as never]);
    expect(save.document.records['e1' as never]).toBe(doc.records['e1' as never]);
    expect(save.assets.size).toBe(1);
  });

  it('FR-AST-003: a re-subset keeps the original source identity, and edited text beyond a subset is reported', async () => {
    const first = await subsetFontsForSave(docOf('Hello', font('f1', 'bundled')), bytesOf, { engines, sha256 });
    const record = first.document.records['f1' as never] as unknown as { hash: string };
    const sub = first.assets.get(record.hash)?.bytes as Uint8Array;
    const edited = {
      ...first.document,
      records: {
        ...first.document.records,
        e1: {
          ...(first.document.records['e1' as never] as object),
          text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hell' }] }] },
        } as unknown as AnyRecord,
      },
    };
    const again = await subsetFontsForSave(edited as DocumentFile, (h) => (h === record.hash ? sub : undefined), { engines, sha256 });
    const line = again.report[0];
    const reRecord = again.document.records['f1' as never] as unknown as { font: { subset: { source: string } } };
    expect(line?.status).toBe('subset');
    expect(reRecord.font.subset.source).toBe(hex(FIRA));
    const gaps = docOf('Hello Ω', record as unknown as { id: string });
    const inventory = glyphInventory(gaps);
    expect(inventory.status === 'complete' && subsetFontGaps(gaps, inventory.codepoints)).toEqual([{ asset: 'f1', missing: [0x20, 0x3a9] }]);
    expect(subsetFontGaps(first.document, [0x48, 0x65])).toEqual([]);
  });

  it('FR-AST-003: re-cutting a subset after text gains a character it cannot draw records only what it still covers', async () => {
    const first = await subsetFontsForSave(docOf('Hello', font('f1', 'bundled')), bytesOf, { engines, sha256 });
    const record = first.document.records['f1' as never] as unknown as { id: string; hash: string };
    const sub = first.assets.get(record.hash)?.bytes as Uint8Array;
    // "o" is dropped (so the cut is smaller) and "Ω" is added, which the subset never had
    const edited = docOf('Hell Ω', record);
    const again = await subsetFontsForSave(edited, (h) => (h === record.hash ? sub : undefined), { engines, sha256 });
    expect(again.report[0]?.status).toBe('subset');
    const reRecord = again.document.records['f1' as never] as unknown as { font: { subset: { unicodes: string } } };
    expect(reRecord.font.subset.unicodes).toBe('U+48,U+65,U+6C');
    const inventory = glyphInventory(again.document);
    expect(inventory.status === 'complete' && subsetFontGaps(again.document, inventory.codepoints)).toEqual([{ asset: 'f1', missing: [0x20, 0x3a9] }]);
  });

  it('FR-AST-003: unicode ranges collapse runs and read back', () => {
    expect(unicodeRangeOf([0x41, 0x42, 0x43, 0xe9, 0x1f600, 0x41])).toBe('U+41-43,U+E9,U+1F600');
    expect(unicodeRangePairs('U+41-43, U+E9,bad,U+1F600')).toEqual([
      [0x41, 0x43],
      [0xe9, 0xe9],
      [0x1f600, 0x1f600],
    ]);
  });
});

/** A worker double: answers with `reply` (or never), records termination. */
function fakeWorker(reply: (input: FontSubsetInput, w: FontJobWorker) => void) {
  const state = { terminated: 0 };
  const worker: FontJobWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (input) => queueMicrotask(() => reply(input, worker)),
    terminate: () => {
      state.terminated += 1;
    },
  };
  return { worker, state };
}
const job: FontSubsetInput = { bytes: FIRA, sourceSha256: hex(FIRA), weight: 400, style: 'normal', codepoints: [0x41], verifiedSource: true };

describe('disposable font worker with a watchdog (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: answers, failures, garbage and overruns all end with the worker terminated', async () => {
    const answer: FontSubsetOutcome = { status: 'kept', reason: 'not-smaller', message: 'x' };
    const ok = fakeWorker((_, w) => w.onmessage?.({ data: answer }));
    expect(await runFontSubsetJob(job, () => ok.worker, globalThis)).toEqual(answer);
    expect(ok.state.terminated).toBe(1);
    const broken = fakeWorker((_, w) => w.onerror?.(new Error('boom')));
    expect(await runFontSubsetJob(job, () => broken.worker, globalThis)).toMatchObject({ status: 'kept', reason: 'engine-failure' });
    expect(broken.state.terminated).toBe(1);
    const garbage = fakeWorker((_, w) => w.onmessage?.({ data: { status: 'subset?' } }));
    expect(await runFontSubsetJob(job, () => garbage.worker, globalThis)).toMatchObject({ reason: 'engine-failure' });
    const unstartable = runFontSubsetJob(
      job,
      () => {
        throw new Error('no workers');
      },
      globalThis,
    );
    expect(await unstartable).toMatchObject({ reason: 'engine-failure', message: 'the font worker could not be started' });
    vi.useFakeTimers();
    try {
      const hung = fakeWorker(() => undefined);
      const pending = runFontSubsetJob(job, () => hung.worker, globalThis);
      await vi.advanceTimersByTimeAsync(FONT_SUBSET_JOB_TIMEOUT_MS - 1);
      expect(hung.state.terminated).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ reason: 'engine-failure', message: 'the font job took longer than 30 s and was stopped' });
      expect(hung.state.terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(FONT_SUBSET_JOB_TIMEOUT_MS).toBe(30_000);
  });

  it('FR-AST-003: the job side subsets with fresh pinned engines, and a planning save can run every font as a job', async () => {
    const answers: FontSubsetOutcome[] = [];
    const scope: FontJobScope = { onmessage: null, postMessage: (m) => answers.push(m) };
    serveFontSubsetJob(scope, async () => MODULES, { sha256, instantiate });
    scope.onmessage?.({ data: job });
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(answers[0]).toMatchObject({ status: 'subset' });
    const unpinned: FontSubsetOutcome[] = [];
    const bad: FontJobScope = { onmessage: null, postMessage: (m) => unpinned.push(m) };
    serveFontSubsetJob(bad, async () => ({ ...MODULES, codec: MODULES.harfbuzz }), { sha256, instantiate });
    bad.onmessage?.({ data: job });
    await vi.waitFor(() => expect(unpinned).toHaveLength(1));
    expect(unpinned[0]).toMatchObject({ reason: 'engine-failure' });
    const jobs: FontSubsetInput[] = [];
    const save = await subsetFontsForSave(docOf('Hi', font('f1', 'google')), bytesOf, {
      sha256,
      job: async (input) => {
        jobs.push(input);
        return { status: 'kept', reason: 'not-smaller', message: 'stub' };
      },
    });
    expect(jobs.map((j) => j.codepoints)).toEqual([[0x48, 0x69]]);
    expect(save.report[0]).toMatchObject({ status: 'kept', reason: 'not-smaller' });
    const throwing = await subsetFontsForSave(docOf('Hi', font('f1', 'google')), bytesOf, { sha256, job: () => Promise.reject(new Error('x')) });
    expect(throwing.report[0]).toMatchObject({ reason: 'engine-failure' });
  });
});
