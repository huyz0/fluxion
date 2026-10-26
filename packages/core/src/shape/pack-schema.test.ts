import { pathBounds } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { parseShapePackCategory, parseShapePackIndex } from '../index.js';
import { evaluateOutline } from './outline.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const raw = import.meta.glob('../../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const index = () => JSON.parse(raw['../../../../fixtures/shape-pack/index.json'] ?? 'null');
const category = () => JSON.parse(raw['../../../../fixtures/shape-pack/categories/basic.json'] ?? 'null');
const policy = (license: string) => ['MIT', 'ISC', 'MIT AND ISC'].includes(license);

describe('declarative shape-pack validation', () => {
  it('FR-LIB-003 NFR-LIC-003: valid licensed wire fixtures validate unchanged and every definition has a nonempty outline', () => {
    const i = index();
    expect(parseShapePackIndex(i, policy)).toEqual({ ok: true, value: i });
    const c = category();
    const result = parseShapePackCategory(c, i, 'basic', policy);
    expect(result).toEqual({ ok: true, value: c });
    for (const def of c.definitions) {
      const outline = evaluateOutline(def, def.defaultSize);
      expect(outline.ok).toBe(true);
      if (outline.ok) {
        const bounds = pathBounds(outline.value.path);
        if (bounds === null) throw new Error('fixture outline has no bounds');
        expect(bounds.w).toBeGreaterThan(0);
        expect(bounds.h).toBeGreaterThan(0);
      }
    }
  });
  it('NFR-LIC-003: absent license, source, notice or credit coverage is refused', () => {
    for (const field of ['license', 'attribution', 'credits']) {
      const bad = index();
      delete bad[field];
      expect(parseShapePackIndex(bad, policy).ok, field).toBe(false);
    }
    for (const field of ['source', 'notice', 'attribution', 'license']) {
      const bad = index();
      delete bad.credits[0][field];
      expect(parseShapePackIndex(bad, policy).ok, field).toBe(false);
    }
    const uncovered = index();
    uncovered.credits[0].definitionIds = ['sample:box'];
    expect(parseShapePackIndex(uncovered, policy).ok).toBe(false);
  });
  it('NFR-LIC-003: scoped credits are complete, unique and point only at indexed IDs', () => {
    const valid = index();
    valid.credits[0].definitionIds = ['sample:box', 'sample:triangle'];
    expect(parseShapePackIndex(valid, policy).ok).toBe(true);
    for (const ids of [[], ['sample:box', 'sample:box'], ['sample:missing']]) {
      const bad = index();
      bad.credits[0].definitionIds = ids;
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
    const duplicate = index();
    duplicate.credits.push(duplicate.credits[0]);
    expect(parseShapePackIndex(duplicate, policy).ok).toBe(false);
  });
  it('NFR-LIC-003: every source license and override is checked without trusting the wrapper', () => {
    const bad = index();
    bad.credits[0].license = 'GPL-3.0-only';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    for (const license of ['unknown-license', 'free text license', '']) {
      const c = category();
      c.definitions[0].license = license;
      expect(parseShapePackCategory(c, index(), 'basic', policy).ok).toBe(false);
    }
    expect(
      parseShapePackIndex(index(), () => {
        throw new Error('policy unavailable');
      }).ok,
    ).toBe(false);
  });
  it('FR-LIB-003: duplicate IDs, wrong namespaces and unindexed categories fail', () => {
    const duplicate = index();
    duplicate.definitions.push(duplicate.definitions[0]);
    expect(parseShapePackIndex(duplicate, policy).ok).toBe(false);
    for (const patch of [{ id: 'other:box' }, { category: 'missing' }]) {
      const bad = index();
      Object.assign(bad.definitions[0], patch);
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
  });
  it('FR-LIB-003: version, path, hash and unknown executable index fields are rejected', () => {
    for (const patch of [{ version: '^1.0.0' }, { formatVersion: '2.0' }, { player: 'evil.js' }, { license: '  ' }]) {
      expect(parseShapePackIndex({ ...index(), ...patch }, policy).ok).toBe(false);
    }
    for (const path of ['../basic.json', 'https://host/basic.json', 'categories/basic.json?x', 'categories/other.json']) {
      const bad = index();
      bad.categories.basic.path = path;
      expect(parseShapePackIndex(bad, policy).ok, path).toBe(false);
    }
    const bad = index();
    bad.categories.basic.sha256 = 'bad';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    const proto = index();
    proto.categories = JSON.parse('{"__proto__":{"path":"categories/basic.json","sha256":"bad"}}');
    expect(parseShapePackIndex(proto, policy).ok).toBe(false);
  });
  it('FR-LIB-003: a category must contain exactly its assigned valid definitions atomically', () => {
    for (const definitions of [[], [category().definitions[0]], [...category().definitions, category().definitions[0]]]) {
      expect(parseShapePackCategory({ formatVersion: '1.0', definitions }, index(), 'basic', policy).ok).toBe(false);
    }
    const bad = category();
    bad.definitions[1].outline.path = 'M0 0L{unknown} 1';
    const result = parseShapePackCategory(bad, index(), 'basic', policy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((d) => d.path.startsWith('/definitions/1'))).toBe(true);
    expect(parseShapePackCategory(category(), index(), 'missing', policy).ok).toBe(false);
  });
  it('FR-LIB-003: provided definition metadata agrees with the index', () => {
    for (const patch of [{ category: 'wrong' }, { keywords: ['wrong'] }, { id: 'sample:unindexed' }]) {
      const bad = category();
      Object.assign(bad.definitions[0], patch);
      expect(parseShapePackCategory(bad, index(), 'basic', policy).ok).toBe(false);
    }
  });
  it('NFR-LIC-003: upstream provenance is pinned and original declarations cannot be empty', () => {
    const valid = index();
    valid.credits[0].source = {
      kind: 'upstream',
      reference: 'Synthetic provenance fixture',
      sha256: 'a'.repeat(64),
      revision: 'fixture-revision',
      modifications: 'Fixture only',
    };
    expect(parseShapePackIndex(valid, policy).ok).toBe(true);
    for (const patch of [{ sha256: 'bad' }, { reference: ' ' }, { kind: 'unknown' }]) {
      const bad = JSON.parse(JSON.stringify(valid));
      Object.assign(bad.credits[0].source, patch);
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
    const bad = index();
    bad.credits[0].source.author = ' ';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
  });
  it('FR-LIB-003: exact prerelease/build versions are accepted but ranges and numeric leading zeros are not', () => {
    expect(parseShapePackIndex({ ...index(), version: '1.2.3-beta.1+build.01' }, policy).ok).toBe(true);
    for (const version of ['01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+', '*']) {
      expect(parseShapePackIndex({ ...index(), version }, policy).ok, version).toBe(false);
    }
  });
});
