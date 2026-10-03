import { describe, expect, it } from 'vitest';
import dangling from './__fixtures__/migration/dangling-section-1.0.flux.json' with { type: 'json' };
import nonconforming from './__fixtures__/migration/nonconforming-1.1.flux.json' with { type: 'json' };
import v10 from './__fixtures__/v1.0/document.flux.json' with { type: 'json' };
import v11 from './__fixtures__/v1.1/document.flux.json' with { type: 'json' };
import v12 from './__fixtures__/v1.2/document.flux.json' with { type: 'json' };
import { MIGRATIONS, type Migration, migrate, type RawDocument } from './migrate.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { isValid, validate } from './validate.js';

// A synthetic older version: in "0.9" screens had `dimensions` instead of `size` and elements kept
// their z-order as a number `z`. The step converts both, so the test exercises a real rewrite.
const synthetic: Migration = {
  from: '0.9',
  to: '1.0',
  up: (doc) => ({
    ...doc,
    schemaVersion: '1.0',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => {
        const r = record as { readonly [key: string]: unknown };
        const { dimensions, z, ...rest } = r;
        const next: { [key: string]: unknown } = { ...rest };
        if (dimensions !== undefined) next['size'] = dimensions;
        if (typeof z === 'number') next['index'] = `a${z}`;
        return [id, next];
      }),
    ),
  }),
};

// 0.9 → 1.0 (synthetic), then the released step
const CHAIN: readonly Migration[] = [synthetic, ...MIGRATIONS];

const v09: RawDocument = {
  schemaVersion: '0.9',
  records: {
    doc: { id: 'doc', type: 'document' },
    s1: { id: 's1', type: 'screen', index: 'a0', dimensions: { w: 800, h: 600 } },
    e1: { id: 'e1', type: 'element', screenId: 's1', z: 0, kind: 'shape', defId: 'basic:rect', transform: { x: 0, y: 0, w: 10, h: 10 } },
  },
};

describe('migrations (FR-DOC-003)', () => {
  it('FR-DOC-003: WHEN a fixture at an older version loads THE SYSTEM SHALL migrate it and it validates', () => {
    expect(validate(v09).map((d) => d.code)).toContain('FLX_VERSION_UNSUPPORTED');
    const r = migrate(v09, CHAIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.applied).toEqual(['0.9→1.0', '1.0→1.1', '1.1→1.2']);
    expect(r.value.document.records['s1']).toEqual({ id: 's1', type: 'screen', index: 'a0', size: { w: 800, h: 600 } });
    expect(validate(r.value.document)).toEqual([]);
  });

  it('FR-DOC-003: the v1.2 fixture validates with 0 errors and round-trips byte for byte', () => {
    expect(validate(v12)).toEqual([]);
    const r = parseDocument(JSON.stringify(v12));
    expect(r.ok && serializeDocument(r.value.document)).toBe(`${JSON.stringify(v12, null, 2)}\n`);
    // sections are records in order, and a screen names one of them
    const types = Object.values(v12.records).map((x) => (x as { type: string }).type);
    expect(types.filter((t) => t === 'section')).toHaveLength(2);
  });

  it('FR-DOC-006: a 1.1 document migrates to 1.2 and round-trips', () => {
    // the released 1.1 fixture is no longer current, and still migrates and validates
    expect(validate(v11).map((d) => d.code)).toContain('FLX_VERSION_UNSUPPORTED');
    const r = migrate(v11);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.applied).toEqual(['1.1→1.2']);
    expect(r.value.document.schemaVersion).toBe('1.2');
    expect(validate(r.value.document)).toEqual([]);
    // nothing else changed: the same records
    expect(r.value.document.records).toEqual(v11.records);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-DOC-006: a 1.1 document with non-conforming new fields migrates to a valid 1.2 one', () => {
    // read as it is, the fixture is not current; migrated, it validates and the bad values are gone
    const r = migrate(nonconforming);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validate(r.value.document)).toEqual([]);
    const doc = r.value.document.records['doc'] as { description?: unknown; tags?: unknown; custom?: unknown };
    expect('description' in doc).toBe(false);
    expect('tags' in doc).toBe(false);
    // a custom entry that is not a string goes, the others stay
    expect(doc.custom).toEqual({ owner: 'platform' });
    // a screen theme naming no theme record goes; one naming a theme stays
    expect('themeId' in (r.value.document.records['s1'] as object)).toBe(false);
    expect((r.value.document.records['s2'] as { themeId?: unknown }).themeId).toBe('th1');
    // the same document at 1.2 without the migration would have been refused
    const raw = { ...nonconforming, schemaVersion: '1.2' };
    expect(validate(raw).length).toBeGreaterThan(0);
  });

  it('FR-DOC-006: a 1.1 document with non-conforming new fields migrates to a valid 1.2 one (every branch)', () => {
    const migrated = (doc: object, s1: object) => {
      const raw = {
        ...v11,
        records: { ...v11.records, doc: { ...v11.records['doc'], ...doc }, s1: { ...v11.records['s1'], ...s1 } },
      };
      const r = migrate(raw);
      if (!r.ok) throw new Error(r.error.message);
      expect(validate(r.value.document)).toEqual([]);
      return r.value.document.records as { doc: { tags?: unknown; custom?: unknown }; s1: { themeId?: unknown } };
    };
    // tags: an array with a member that is not a string goes whole, an array of strings stays
    expect('tags' in migrated({ tags: ['a', 1] }, {}).doc).toBe(false);
    expect(migrated({ tags: ['a', 'b'] }, {}).doc.tags).toEqual(['a', 'b']);
    // custom: an array or a string is not an object and goes; an object keeps its string entries
    expect('custom' in migrated({ custom: ['a'] }, {}).doc).toBe(false);
    expect('custom' in migrated({ custom: 'a' }, {}).doc).toBe(false);
    expect(migrated({ custom: { a: 'x', b: null, c: { d: 1 } } }, {}).doc.custom).toEqual({ a: 'x' });
    // a screen's theme: a number, a missing record and a record of another type go; a theme record stays
    expect('themeId' in migrated({}, { themeId: 5 }).s1).toBe(false);
    expect('themeId' in migrated({}, { themeId: 'doc' }).s1).toBe(false);
    expect(migrated({}, { themeId: 'th1' }).s1.themeId).toBe('th1');
  });

  it('FR-DOC-006: a document with description, tags and custom key-values round-trips', () => {
    const doc = v12.records['doc'] as { description?: string; tags?: string[]; custom?: { [key: string]: string } };
    expect(doc.description).toContain('Checkout');
    expect(doc.tags).toEqual(['architecture', 'checkout']);
    expect(doc.custom).toEqual({ owner: 'platform', review: '2026-Q4' });
    const r = parseDocument(JSON.stringify(v12));
    expect(r.ok && r.value.document.records['doc']).toEqual(v12.records['doc']);
    // the typed fields refuse other shapes
    for (const bad of [{ description: 5 }, { tags: 'x' }, { tags: [1] }, { custom: { a: 1 } }]) {
      const broken = { ...v12, records: { ...v12.records, doc: { ...v12.records['doc'], ...bad } } };
      expect(validate(broken).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("FR-THM-004: a screen's theme reference round-trips and must name a theme record", () => {
    expect((v12.records['s2'] as { themeId?: string }).themeId).toBe('th2');
    const r = parseDocument(JSON.stringify(v12));
    expect(r.ok && r.value.document.records['s2']).toEqual(v12.records['s2']);
    const naming = (themeId: string) => ({ ...v12, records: { ...v12.records, s2: { ...v12.records['s2'], themeId } } });
    // a missing record is a missing reference, a record of another type a wrong-type one
    expect(validate(naming('th-gone')).map((d) => d.code)).toContain('FLX_REF_MISSING');
    expect(validate(naming('s1')).map((d) => d.code)).toContain('FLX_REF_WRONG_TYPE');
  });

  it('FR-SCR-004: a document without sections migrates and round-trips', () => {
    // the 1.0 fixture is no longer current: validating it as it is says so
    expect(validate(v10).map((d) => d.code)).toContain('FLX_VERSION_UNSUPPORTED');
    const r = migrate(v10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.applied).toEqual(['1.0→1.1', '1.1→1.2']);
    expect(r.value.document.schemaVersion).toBe('1.2');
    expect(validate(r.value.document)).toEqual([]);
    // nothing else changed: the same records, the same bytes once the version is told
    expect(r.value.document.records).toEqual(v10.records);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
    // a 1.0 screen's `sectionId` named nothing; it goes, and the document validates
    const old = migrate(dangling);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(JSON.stringify(old.value.document)).not.toContain('sec-gone');
    expect(validate(old.value.document)).toEqual([]);
    // read as 1.1, a screen naming no section is an error with a suggestion
    const broken = {
      ...old.value.document,
      records: { ...old.value.document.records, s1: { ...(old.value.document.records['s1'] as object), sectionId: 'sec-gone' } },
    };
    expect(validate(broken).map((d) => d.code)).toContain('FLX_REF_MISSING');
  });

  it('FR-DOC-003: migrating twice equals migrating once', () => {
    const once = migrate(v09, CHAIN);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(migrate(once.value.document, CHAIN)).toEqual({ ok: true, value: { document: once.value.document, applied: [] } });
    expect(migrate(v12)).toEqual({ ok: true, value: { document: v12, applied: [] } });
  });

  it('the released chain is 1.0 to 1.1 to 1.2, and refuses what it cannot convert', () => {
    expect(MIGRATIONS.map((m) => `${m.from}→${m.to}`)).toEqual(['1.0→1.1', '1.1→1.2']);
    const code = (doc: unknown, chain?: readonly Migration[]) => {
      const r = migrate(doc, chain);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code(v09)).toBe('MIGRATION_UNSUPPORTED');
    expect(code({ ...v09, schemaVersion: '2.0' })).toBe('MIGRATION_UNSUPPORTED');
    expect(code({ ...v09, schemaVersion: 'one' })).toBe('MIGRATION_UNSUPPORTED');
    // "1.00" is not the current version under another spelling: it is no version, and nothing is migrated or kept under it
    for (const version of ['1.00', '01.0', '1.01']) expect(code({ ...v09, schemaVersion: version }), version).toBe('MIGRATION_UNSUPPORTED');
    expect(code(42)).toBe('MIGRATION_UNSUPPORTED');
    expect(code({ ...v09, schemaVersion: '1.3' })).toBe('ok');
    expect(code(v10)).toBe('ok');
    expect(code(v09, [{ from: '0.9', to: '1.0', up: (d) => ({ ...d, schemaVersion: '0.9' }) }])).toBe('MIGRATION_UNSUPPORTED');
    // a chain that loops never hangs
    const loop: Migration[] = [
      { from: '0.8', to: '0.9', up: (d) => ({ ...d, schemaVersion: '0.9' }) },
      { from: '0.9', to: '0.8', up: (d) => ({ ...d, schemaVersion: '0.8' }) },
    ];
    expect(code({ ...v09, schemaVersion: '0.8' }, loop)).toBe('MIGRATION_UNSUPPORTED');
    expect(isValid(validate(v12))).toBe(true);
  });
});
