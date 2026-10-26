import { allowsShapePackContentLicense, type ShapePackSubset } from '@fluxion/core';
import type { DocumentFile, QualifiedName } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { decodeBase64 } from './base64.js';
import { prepareUsedShapePacks } from './index.js';
import { sha256Hex } from './sha256.js';
import { decodeUtf8 } from './utf8.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

function source(namespace = 'sample', count = 4) {
  const definitions = Array.from({ length: count }, (_, i) => ({
    id: `${namespace}:s${i}` as QualifiedName,
    outline: { path: 'M0 0H{w}V{h}H0Z' },
    defaultSize: { w: 80, h: 40 },
  }));
  const credit = {
    id: 'global',
    license: 'MIT',
    attribution: 'Fluxion contributors',
    notice: 'Original test geometry, MIT.',
    source: { kind: 'original' as const, author: 'Fluxion contributors', statement: 'Original geometric test fixtures.' },
  };
  return {
    kind: 'distribution' as const,
    definitions,
    index: {
      format: 'fluxion-shape-pack' as const,
      formatVersion: '1.0' as const,
      id: namespace,
      version: '1.0.0',
      name: 'Test shapes',
      license: 'MIT',
      attribution: 'Fluxion contributors',
      categories: { basic: { path: 'categories/basic.json', sha256: '0'.repeat(64) } },
      definitions: definitions.map((d) => ({ id: d.id, name: d.id, keywords: [], category: 'basic' })),
      credits: [
        credit,
        { ...credit, id: 'scoped', definitionIds: definitions.slice(0, 2).map((d) => d.id) },
        { ...credit, id: 'unused', definitionIds: [required(definitions[count - 1]).id] },
      ],
    },
  };
}
function document(ids: readonly QualifiedName[]): DocumentFile {
  const b = documentBuilder();
  const screen = b.screen();
  const group = b.rect(screen);
  ids.forEach((defId, i) => {
    b.rect(screen, { defId, ...(i === 0 ? { parentId: group } : {}) });
  });
  const doc = b.build();
  return { ...doc, records: { ...doc.records, [group]: { ...required(doc.records[group]), kind: 'group' } } };
}
const options = () => ({
  builtinIds: new Set(['basic:rect']),
  licensePolicy: allowsShapePackContentLicense,
  hasher: { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) },
});
async function prepared(doc: DocumentFile, sources: Parameters<typeof prepareUsedShapePacks>[1]) {
  const result = await prepareUsedShapePacks(doc, sources, options());
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const unpack = (entries: ReadonlyMap<string, Uint8Array>): ShapePackSubset[] => [...entries.values()].map((b) => JSON.parse(decodeUtf8(b)));

it('FR-LIB-009 NFR-LIC-003: three of 5000 supplied definitions, including a grouped child, keep only used geometry and applicable credits', async () => {
  const pack = source('sample', 5000);
  const ids: QualifiedName[] = ['sample:s7', 'sample:s0', 'sample:s23'];
  const out = await prepared(document(ids), [pack]);
  expect([...out.extraEntries.keys()]).toEqual(['plugins/sample@1.0.0/defs.json']);
  const saved = required(unpack(out.extraEntries)[0]);
  expect(saved.definitions.map((d) => d.id)).toEqual(['sample:s0', 'sample:s23', 'sample:s7']);
  expect(saved.credits.map((c) => c.id)).toEqual(['global', 'scoped']);
  expect(saved.credits[1]?.definitionIds).toEqual(['sample:s0']);
  expect(saved.credits[0]).toEqual(pack.index.credits[0]);
  expect(out.locks).toHaveLength(1);
  expect(out.locks[0]).toMatchObject({
    kind: 'declarative-shapes',
    id: 'sample',
    version: '1.0.0',
    packFormat: '1.0',
    entry: 'plugins/sample@1.0.0/defs.json',
  });
  const digest = decodeBase64(required(out.locks[0]).integrity.slice(7));
  expect([...required(digest)].map((n) => n.toString(16).padStart(2, '0')).join('')).toBe(sha256Hex(required([...out.extraEntries.values()][0])));
});

it('FR-LIB-009: reordered inputs produce identical bytes and locks, and embedded-only preparation can shrink a saved subset', async () => {
  const a = source();
  const b = source('other');
  const doc = document(['sample:s0', 'sample:s1', 'other:s2']);
  const first = await prepared(doc, [a, b]);
  a.definitions.reverse();
  a.index.definitions.reverse();
  a.index.credits.reverse();
  for (const credit of a.index.credits) if ('definitionIds' in credit) credit.definitionIds.reverse();
  const second = await prepared(doc, [b, a]);
  expect(second).toEqual(first);
  const embedded = unpack(first.extraEntries).map((subset) => ({ kind: 'embedded' as const, subset }));
  const reduced = await prepared(document(['sample:s1']), embedded);
  expect(unpack(reduced.extraEntries)[0]?.definitions.map((d) => d.id)).toEqual(['sample:s1']);
  expect(unpack(reduced.extraEntries)[0]?.credits.find((c) => c.id === 'scoped')?.definitionIds).toEqual(['sample:s1']);
  expect(reduced.locks.map((l) => l.id)).toEqual(['sample']);
  expect((await prepared(document([]), embedded)).locks).toEqual([]);
  expect((await prepared(document(['basic:rect']), [])).extraEntries.size).toBe(0);
});

it('FR-LIB-009 NFR-SEC-001: duplicate namespaces, unindexed or invalid geometry, unknown source kinds and unresolved IDs reject atomically', async () => {
  const doc = document(['sample:s0']);
  const bads: unknown[][] = [
    [source(), source()],
    [{ ...source(), kind: 'unknown' }],
    [null],
    [{ ...source(), definitions: null }],
    [{ kind: 'embedded', subset: {} }],
  ];
  const duplicate = source();
  duplicate.definitions.push(required(duplicate.definitions[0]));
  bads.push([duplicate]);
  const unindexed = source();
  required(unindexed.definitions[0]).id = 'sample:missing';
  bads.push([unindexed]);
  const foreign = source();
  required(foreign.definitions[0]).id = 'other:s0';
  bads.push([foreign]);
  const invalid = source();
  required(invalid.definitions[0]).outline.path = 'M{unknown} 0';
  bads.push([invalid]);
  const missing = source();
  missing.definitions.shift();
  bads.push([missing]);
  for (const sources of bads) expect(await Reflect.apply(prepareUsedShapePacks, undefined, [doc, sources, options()])).toMatchObject({ ok: false });
  expect(await prepareUsedShapePacks(document(['missing:s0']), [source()], options())).toMatchObject({ ok: false });
});

it('NFR-LIC-003: rejected defaults, credits and unused geometry overrides cannot enter a prepared result', async () => {
  for (const target of ['default', 'credit', 'override']) {
    const pack = source();
    if (target === 'default') pack.index.license = 'GPL-3.0-only';
    else if (target === 'credit') required(pack.index.credits[0]).license = 'GPL-3.0-only';
    else Object.assign(required(pack.definitions[3]), { license: 'GPL-3.0-only' });
    expect(await prepareUsedShapePacks(document(['sample:s0']), [pack], options()), target).toMatchObject({ ok: false });
  }
});

it('FR-LIB-009: malformed or rejected hashes return diagnostics rather than partial entries', async () => {
  for (const sha256 of [
    async () => 'bad',
    async () => {
      throw new Error('unavailable');
    },
  ]) {
    expect(await prepareUsedShapePacks(document(['sample:s0']), [source()], { ...options(), hasher: { sha256 } })).toMatchObject({ ok: false });
  }
});

it('FR-LIB-009: all sources and hash ownership are captured before awaiting the port', async () => {
  const a = source();
  const b = source('other');
  const doc = document(['sample:s0', 'other:s0']);
  const expected = await prepared(doc, [a, b]);
  let release: (value: string) => void = (_value: string) => {
    throw new Error('hash not started');
  };
  let firstHash = '';
  let calls = 0;
  const opts = options();
  opts.hasher.sha256 = async (bytes) => {
    const hash = sha256Hex(bytes);
    bytes.fill(0);
    if (calls++ > 0) return hash;
    firstHash = hash;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  const pending = prepareUsedShapePacks(doc, [a, b], opts);
  a.index.id = 'changed';
  required(b.definitions[0]).outline.path = 'M99 99';
  opts.builtinIds.add('sample:s0');
  for (const record of Object.values(doc.records)) if (record['kind'] === 'shape') Object.assign(record, { defId: 'missing:new' });
  opts.hasher.sha256 = async () => 'bad';
  opts.licensePolicy = () => false;
  release(firstHash);
  expect(await pending).toEqual({ ok: true, value: expected });
});

it('FR-LIB-009: supplied geometry metadata must agree with the index even when unused', async () => {
  for (const patch of [{ category: 'wrong' }, { keywords: ['wrong'] }]) {
    const pack = source();
    Object.assign(required(pack.definitions[3]), patch);
    expect(await prepareUsedShapePacks(document(['sample:s0']), [pack], options())).toMatchObject({ ok: false });
  }
});

it('NFR-LIC-003: permitted per-definition licenses and exact source notices survive preparation', async () => {
  const pack = source();
  Object.assign(required(pack.definitions[0]), { license: 'ISC' });
  required(pack.index.credits[0]).notice = 'Original notice: é <literal>\nSecond line.';
  const out = unpack((await prepared(document(['sample:s0']), [pack])).extraEntries);
  expect(out[0]?.definitions[0]?.license).toBe('ISC');
  expect(out[0]?.credits[0]?.notice).toBe(required(pack.index.credits[0]).notice);
});

it('FR-LIB-009: a later hash failure exposes no earlier prepared entries and a throwing policy fails closed', async () => {
  const a = source();
  const b = source('other');
  let calls = 0;
  const result = await prepareUsedShapePacks(document(['sample:s0', 'other:s0']), [a, b], {
    ...options(),
    hasher: {
      sha256: async (bytes) => {
        if (calls++ > 0) throw new Error('second hash failed');
        return sha256Hex(bytes);
      },
    },
  });
  expect(calls).toBe(2);
  expect(result).toMatchObject({ ok: false });
  expect(result).not.toHaveProperty('value');
  expect(
    await prepareUsedShapePacks(document(['sample:s0']), [a], {
      ...options(),
      licensePolicy: () => {
        throw new Error('unavailable');
      },
    }),
  ).toMatchObject({ ok: false });
});
