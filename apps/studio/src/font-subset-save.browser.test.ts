import type { FontJobWorker } from '@fluxion/format';
import type { DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { fileBytes, openFileBytes, type SaveInput, webHasher } from './file-session.js';
import { fontReportLine, studioSubsetDeps } from './font-subset-port.js';

// Subset-on-save in Chromium (FR-AST-003, ADR-0051, M18.40): each font job runs in a real module worker; the saved file reopens offline with a
// validated WOFF2 subset that draws the text exactly as the original did; a save with the option off writes the original bytes; a worker that
// cannot run keeps the whole font.
const FIRA_URL = Object.values(import.meta.glob('../../../fixtures/fonts/fira-sans-400.ttf', { query: '?url', import: 'default', eager: true }))[0] ?? '';
const TEXT = 'Subset office façade';

async function input(source: string): Promise<SaveInput> {
  const bytes = new Uint8Array(await (await fetch(FIRA_URL)).arrayBuffer());
  const hash = await webHasher.sha256(bytes);
  const font = { family: 'Fira Sans', weight: 400, style: 'normal', source, license: 'OFL-1.1', copyright: 'Copyright 2012 Mozilla' };
  const records = {
    d: { id: 'd', type: 'document', title: 'Fonts' },
    s1: { id: 's1', type: 'screen', name: 'One', index: 'a0' },
    e1: {
      id: 'e1',
      type: 'element',
      kind: 'text',
      screenId: 's1',
      index: 'a0',
      transform: { x: 0, y: 0, w: 400, h: 60, rotation: 0 },
      text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }] },
    },
    f1: { id: 'f1', type: 'asset', hash, mime: 'font/ttf', size: bytes.length, name: 'FiraSans-Regular.ttf', font },
  };
  const document = { schemaVersion: '1.7', records } as unknown as DocumentFile;
  return { file: undefined, document, bytesOf: async (id) => (id === 'f1' ? { bytes, mime: 'font/ttf' } : undefined), hasher: webHasher, appVersion: '0.0.0' };
}

async function pixels(family: string, bytes: Uint8Array): Promise<Uint8ClampedArray> {
  document.fonts.add(await new FontFace(family, bytes.slice().buffer).load());
  const canvas = new OffscreenCanvas(700, 80);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.font = `40px "${family}", monospace`;
  ctx.fillText(TEXT, 10, 55);
  return ctx.getImageData(0, 0, 700, 80).data;
}

describe('subset-on-save in the studio (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: an enabled save writes a validated subset that reopens and draws the same pixels offline', async () => {
    const save = await input('google');
    const saved = await fileBytes({ ...save, subsetFonts: studioSubsetDeps() });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.value.fonts).toMatchObject([{ asset: 'f1', status: 'subset' }]);
    expect(fontReportLine(saved.value.fonts)).toMatch(/^1 font was subset to the text they draw/);
    const opened = await openFileBytes('subset.flux', saved.value.bytes, webHasher);
    if (!opened.ok) throw new Error(opened.error);
    const record = opened.value.document.records['f1' as never] as unknown as { hash: string; mime: string; font: { subset: { source: string } } };
    const original = (await save.bytesOf('f1'))?.bytes as Uint8Array;
    expect(record.mime).toBe('font/woff2');
    expect(record.font.subset.source).toBe(await webHasher.sha256(original));
    const subset = opened.value.assets.get(record.hash)?.bytes as Uint8Array;
    expect(subset.length).toBeLessThan(original.length / 10);
    // the live document still names the original bytes
    expect((save.document.records['f1' as never] as unknown as { hash: string }).hash).toBe(await webHasher.sha256(original));
    const [a, b] = [await pixels('Saved subset', subset), await pixels('Original whole', original)];
    expect(a.some((v) => v !== 0)).toBe(true);
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });

  it('FR-AST-003: the default save keeps the whole font, and a font job that cannot run keeps it whole with a reason', async () => {
    const save = await input('google');
    const original = (await save.bytesOf('f1'))?.bytes as Uint8Array;
    const off = await fileBytes(save);
    if (!off.ok) throw new Error(off.error);
    expect(off.value.fonts).toEqual([]);
    const opened = await openFileBytes('whole.flux', off.value.bytes, webHasher);
    if (!opened.ok) throw new Error(opened.error);
    const record = opened.value.document.records['f1' as never] as unknown as { hash: string; mime: string };
    expect(record).toMatchObject({ hash: await webHasher.sha256(original), mime: 'font/ttf' });
    expect(opened.value.assets.get(record.hash)?.bytes).toEqual(original);
    const broken = (): FontJobWorker => {
      throw new Error('workers are blocked');
    };
    // a fresh cache: the page's cache already holds this font's subset from the first test, which would need no worker
    const failed = await fileBytes({ ...save, subsetFonts: studioSubsetDeps(broken, new Map()) });
    if (!failed.ok) throw new Error(failed.error);
    expect(failed.value.fonts).toMatchObject([{ status: 'kept', reason: 'engine-failure' }]);
    expect(fontReportLine(failed.value.fonts)).toContain('FiraSans-Regular.ttf stayed whole');
    const reopened = await openFileBytes('kept.flux', failed.value.bytes, webHasher);
    if (!reopened.ok) throw new Error(reopened.error);
    expect(reopened.value.assets.get(record.hash)?.bytes).toEqual(original);
    const upload = await fileBytes({ ...(await input('upload')), subsetFonts: studioSubsetDeps() });
    expect(upload.ok && upload.value.fonts).toMatchObject([{ status: 'kept', reason: 'unverified-source' }]);
  });

  it('FR-AST-003: text a subset no longer draws is reported on the next save', async () => {
    const save = await input('google');
    const first = await fileBytes({ ...save, subsetFonts: studioSubsetDeps() });
    if (!first.ok) throw new Error(first.error);
    const opened = await openFileBytes('subset.flux', first.value.bytes, webHasher);
    if (!opened.ok) throw new Error(opened.error);
    const doc = opened.value.document;
    const e1 = doc.records['e1' as never] as unknown as Record<string, unknown>;
    const edited = {
      ...doc,
      records: { ...doc.records, e1: { ...e1, text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${TEXT} Ω` }] }] } } },
    } as unknown as DocumentFile;
    const again = await fileBytes({ file: opened.value, document: edited, bytesOf: async () => undefined, hasher: webHasher, appVersion: '0.0.0' });
    if (!again.ok) throw new Error(again.error);
    expect(again.value.fontGaps).toEqual([{ name: 'FiraSans-Regular.woff2', missing: [0x3a9] }]);
    expect(fontReportLine([], again.value.fontGaps)).toContain('does not draw “Ω”');
  });
});
