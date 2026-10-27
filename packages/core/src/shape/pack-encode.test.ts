import { describe, expect, it } from 'vitest';
import {
  allowsShapePackContentLicense,
  canonicalJson,
  encodeShapePack,
  parseShapePackCategory,
  parseShapePackIndex,
  type ShapeDef,
  type ShapePackDraft,
  sha256Hex,
} from '../index.js';

const box: ShapeDef = {
  id: 'sample:box',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  defaultSize: { w: 120, h: 60 },
  keywords: ['box'],
  category: 'boxes',
};
const credit = {
  id: 'fluxion',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  notice: 'MIT License',
  source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
} as const;
const draft = (definitions: ShapePackDraft['definitions'], extra: Partial<ShapePackDraft> = {}): ShapePackDraft => ({
  id: 'sample',
  version: '1.0.0',
  name: 'Sample',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [credit],
  definitions,
  ...extra,
});
const policy = allowsShapePackContentLicense;
// every byte here is ASCII; core has no TextDecoder
const text = (bytes: Uint8Array | undefined) => String.fromCharCode(...(bytes ?? []));
const at = (category: string | undefined, local: string): ShapePackDraft['definitions'][number] => {
  const { category: _, ...rest } = box;
  return { name: local, def: { ...rest, id: `sample:${local}`, ...(category === undefined ? {} : { category }) } };
};

describe('one shared pack encoder (M18.108, ADR-0196)', () => {
  it('FR-LIB-007: canonical JSON sorts keys at every depth, drops undefined, writes -0 as 0 and ends in a newline', () => {
    expect(canonicalJson({ b: 1, a: { d: -0, c: undefined, b: [undefined, 2] } })).toBe(
      '{\n  "a": {\n    "b": [\n      null,\n      2\n    ],\n    "d": 0\n  },\n  "b": 1\n}\n',
    );
    expect(canonicalJson(JSON.parse('{"__proto__":1}'))).toBe('{\n  "__proto__": 1\n}\n');
  });

  it('FR-LIB-007, FR-LIB-009: the same draft gives the same validated bytes, with each category hashed in the index', () => {
    const encoded = encodeShapePack(draft([at('boxes', 'a'), at('Charts & Graphs', 'b'), at(undefined, 'c'), at('boxes', 'd')]), policy);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const { files, index, definitions } = encoded.value;
    expect([...files.keys()]).toEqual(['index.json', 'categories/boxes.json', 'categories/charts-graphs.json', 'categories/uncategorized.json']);
    const again = encodeShapePack(draft([at('boxes', 'a'), at('Charts & Graphs', 'b'), at(undefined, 'c'), at('boxes', 'd')]), policy);
    expect(again.ok && [...again.value.files.values()].map(text)).toEqual([...files.values()].map(text));
    for (const [slug, entry] of Object.entries(index.categories)) {
      expect(entry.sha256).toBe(sha256Hex(files.get(entry.path) ?? new Uint8Array()));
      expect(parseShapePackCategory(JSON.parse(text(files.get(entry.path))), index, slug, policy).ok).toBe(true);
    }
    expect(text(files.get('index.json'))).toBe(canonicalJson(index));
    expect(parseShapePackIndex(JSON.parse(text(files.get('index.json'))), policy)).toEqual({ ok: true, value: index });
    // the index keeps draft order; each category file keeps it among its own definitions
    expect(definitions.map((d) => d.category)).toEqual(['boxes', 'charts-graphs', 'uncategorized', 'boxes']);
    expect(index.definitions.map((d) => [d.id, d.name, d.category])).toEqual([
      ['sample:a', 'a', 'boxes'],
      ['sample:b', 'b', 'charts-graphs'],
      ['sample:c', 'c', 'uncategorized'],
      ['sample:d', 'd', 'boxes'],
    ]);
    expect(JSON.parse(text(files.get('categories/boxes.json'))).definitions.map((d: ShapeDef) => d.id)).toEqual(['sample:a', 'sample:d']);
  });

  it('FR-LIB-009: category texts that slug alike or to nothing are numbered, never merged, and none takes uncategorized', () => {
    const encoded = encodeShapePack(
      draft([at('Charts & Graphs', 'a'), at('Charts Graphs', 'b'), at('Флаги', 'c'), at('矢印', 'd'), at('uncategorized', 'e'), at(undefined, 'f')]),
      policy,
    );
    expect(encoded.ok && encoded.value.definitions.map((d) => d.category)).toEqual([
      'charts-graphs',
      'charts-graphs-2',
      'category',
      'category-2',
      'uncategorized-2',
      'uncategorized',
    ]);
  });

  it('NFR-LIC-003, FR-LIB-007: an empty pack, an id outside the namespace, an invalid definition and unpermitted rights are refused whole', () => {
    const problems = (d: ShapePackDraft) => {
      const r = encodeShapePack(d, policy);
      return r.ok ? [] : r.error.map((e) => e.path);
    };
    expect(problems(draft([]))).toEqual(['/definitions']);
    expect(problems(draft([{ name: 'X', def: { ...box, id: 'other:x' } }]))).toEqual(['/definitions/0/def/id']);
    expect(problems(draft([{ name: 'X', def: { ...box, defaultSize: { w: 0, h: 0 } } }]))).not.toEqual([]);
    expect(problems(draft([at('boxes', 'a')], { credits: [{ ...credit, license: 'GPL-3.0-only' }] }))).toEqual(['/credits/0/license']);
    expect(problems(draft([{ name: 'X', def: { ...box, license: 'GPL-3.0-only' } }]))).toEqual(['/categories/boxes/definitions/0/license']);
    expect(problems(draft([{ name: '', def: box }]))).not.toEqual([]);
  });
});
