import { expect, it, vi } from 'vitest';
import { importIconifyCollection } from './iconify-import.js';
import type { SvgPaintRequest, SvgPaintWitness } from './svg-import.js';

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const FILES = import.meta.glob('../../../specs/import/corpus/iconify/original-*.json', { query: '?raw', import: 'default', eager: true });
const corpus = (name: string) => FILES[`../../../specs/import/corpus/iconify/${name}`] ?? '';
const group = (r: SvgPaintRequest) => r.artwork.root.children.find((c) => typeof c !== 'string' && c.name === 'g');

it('FR-LIB-005: resolves defaults, nested aliases, rotations, flips, hidden entries and categories', async () => {
  const requests: SvgPaintRequest[] = [];
  const record: SvgPaintWitness = async (r) => {
    requests.push(r);
    return witness(r);
  };
  const report = await importIconifyCollection(corpus('original-aliases.json'), { witness: record });
  expect(report.status).toBe('processed');
  if (report.status !== 'processed') return;
  expect([report.iconCount, report.aliasCount, report.acceptedCount]).toEqual([2, 3, 5]);
  expect(report.entries.map((e) => [e.id, e.status, e.hidden, e.parent])).toEqual([
    ['fluxion-corpus:hidden', 'accepted', true, undefined],
    ['fluxion-corpus:root', 'accepted', false, undefined],
    ['fluxion-corpus:mirrored', 'accepted', false, 'root'],
    ['fluxion-corpus:nested', 'accepted', false, 'mirrored'],
    ['fluxion-corpus:turned', 'accepted', false, 'root'],
  ]);
  const byName = new Map(report.entries.map((e) => [e.name, e]));
  const def = (name: string) => {
    const e = byName.get(name);
    return e?.status === 'accepted' ? e.value.definition : undefined;
  };
  expect(def('root')?.defaultSize).toEqual({ w: 32, h: 32 });
  expect(def('root')?.category).toBe('Geometry');
  expect(def('root')?.keywords).toEqual(['Geometry', 'mirrored', 'turned']);
  expect(def('nested')?.keywords).toEqual(['Geometry', 'mirrored', 'root']);
  expect(def('nested')?.anchors).toHaveLength(4);
  const attr = (name: string) => {
    const at = report.entries.findIndex((e) => e.name === name);
    const node = group(requests[at] as SvgPaintRequest);
    if (!node || typeof node === 'string') return undefined;
    const { transform } = node.attributes;
    return transform;
  };
  expect(attr('root')).toBeUndefined();
  expect(attr('mirrored')).toBe('translate(32 0) scale(-1 1)');
  expect(attr('turned')).toBe('rotate(90 16 16)');
  // hFlip XOR'd with vFlip becomes a half turn (Iconify's mergeIconTransformations).
  expect(attr('nested')).toBe('rotate(180 16 16)');
});

it('FR-LIB-005: alias cycles and missing parents are refused individually without hiding valid icons', async () => {
  const port = vi.fn(witness);
  const report = await importIconifyCollection(corpus('original-cycle.json'), { witness: port });
  expect(report.status).toBe('processed');
  if (report.status !== 'processed') return;
  expect(report.entries.map((e) => [e.name, e.status])).toEqual([
    ['root', 'accepted'],
    ['a', 'refused'],
    ['b', 'refused'],
  ]);
  for (const e of report.entries.slice(1)) if (e.status === 'refused') expect(e.diagnostics[0]?.message).toMatch(/^alias-cycle/);
  expect(port).toHaveBeenCalledTimes(1);
  const missing = await importIconifyCollection(
    JSON.stringify({ prefix: 'x', icons: { a: { body: '<rect width="4" height="4"/>' } }, aliases: { b: { parent: 'nope' } } }),
    {
      witness,
    },
  );
  expect(missing.status === 'processed' && missing.entries[1]).toMatchObject({ status: 'refused', diagnostics: [{ message: 'missing-parent: nope' }] });
});

it('FR-LIB-005 NFR-SEC-001: malformed collections, unsafe bodies and invalid properties fail without effects', async () => {
  const port = vi.fn(witness);
  for (const text of [
    'nope',
    '[]',
    '{"prefix":"x"}',
    '{"prefix":"Bad","icons":{"a":{"body":""}}}',
    '{"prefix":"x","icons":{}}',
    '{"prefix":"x","width":-1,"icons":{"a":{"body":""}}}',
  ])
    expect((await importIconifyCollection(text, { witness: port })).status).toBe('failed');
  expect((await importIconifyCollection('{"prefix":"x","icons":{"a":{"body":""}}}', { witness: port, namespace: 'Bad' })).status).toBe('failed');
  const report = await importIconifyCollection(
    JSON.stringify({
      prefix: 'x',
      icons: {
        script: { body: '<script>alert(1)</script><rect width="4" height="4"/>' },
        external: { body: '<image href="https://example.com/a.png" width="4" height="4"/>' },
        rotated: { body: '<rect/>', rotate: 1.5 },
        Upper: { body: '<rect width="4" height="4"/>' },
      },
      aliases: { cyclic: { parent: 'cyclic' } },
    }),
    { witness: port },
  );
  expect(report.status === 'processed' && report.entries.every((e) => e.status === 'refused')).toBe(true);
  expect(port).not.toHaveBeenCalled();
  const huge = `{"prefix":"x","icons":{${Array.from({ length: 50_001 }, (_, i) => `"i${i}":{"body":""}`).join(',')}}}`;
  expect(await importIconifyCollection(huge, { witness: port })).toMatchObject({
    status: 'failed',
    diagnostics: [{ message: expect.stringContaining('50000') }],
  });
});

it('FR-LIB-005 NFR-LIC-003: provenance retains source identity and declared metadata without approving it', async () => {
  const report = await importIconifyCollection(corpus('original-aliases.json'), { witness, namespace: 'mine' });
  expect(report.status === 'processed' && report.provenance).toEqual({
    prefix: 'fluxion-corpus',
    sourceSha256: '5e977a856967838eef52fe7fc8698f9c40f5b315b3e6fca46febc03d3ecfc2e6',
  });
  expect(report.status === 'processed' && report.entries.every((e) => e.id.startsWith('mine:'))).toBe(true);
});

it('FR-LIB-005: collection transformations merge with icons; total conversion work is bounded across aliases', async () => {
  const requests: SvgPaintRequest[] = [];
  const record: SvgPaintWitness = async (r) => {
    requests.push(r);
    return witness(r);
  };
  const turned = await importIconifyCollection(
    JSON.stringify({ prefix: 'x', rotate: 1, hFlip: true, icons: { a: { body: '<rect width="4" height="4"/>', rotate: 1, hFlip: true } } }),
    {
      witness: record,
    },
  );
  expect(turned.status === 'processed' && turned.acceptedCount).toBe(1);
  // rotations add (1 + 1) and flips XOR (true, true): a plain half turn, as Iconify renders it
  const node = group(requests[0] as SvgPaintRequest);
  expect(node && typeof node !== 'string' && Object.values(node.attributes)).toEqual(['rotate(180 8 8)']);
  const body = `<rect width="4" height="4"/>${' '.repeat(1_900_000)}`;
  const aliases = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, { parent: 'big' }]));
  const port = vi.fn(witness);
  const heavy = await importIconifyCollection(JSON.stringify({ prefix: 'x', icons: { big: { body } }, aliases }), { witness: port });
  expect(heavy.status).toBe('processed');
  if (heavy.status !== 'processed') return;
  const limited = heavy.entries.filter((e) => e.status === 'refused' && e.diagnostics[0]?.message.startsWith('collection-work-limit'));
  expect([heavy.acceptedCount, limited.length]).toEqual([8, 3]);
  expect(port).toHaveBeenCalledTimes(8);
});
