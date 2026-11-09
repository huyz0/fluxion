// FR-DOC-004: every referential check is read back as exact diagnostics (code, path, message, hint),
// so a dropped check, field, type, message or ordering changes a verdict in this file.
import { describe, expect, it } from 'vitest';
import { checkReferences } from './references.js';

type R = { readonly id: string; readonly type: string; readonly [key: string]: unknown };
const map = (...records: R[]) => new Map(records.map((r) => [r.id, r]));
const doc: R = { id: 'doc', type: 'document' };
const screen: R = { id: 's1', type: 'screen', index: 'a0' };
const group = (id: string, extra: Record<string, unknown> = {}): R => ({ id, type: 'element', kind: 'group', screenId: 's1', index: id, ...extra });
const check = (...records: R[]) => checkReferences(map(doc, screen, ...records));
const codes = (...records: R[]) => check(...records).map((d) => d.code);

describe('referential checks, one by one', () => {
  it('FR-DOC-004: a complete minimal document has no diagnostics', () => {
    expect(check()).toEqual([]);
  });

  it('FR-DOC-004: the document record is required once, and its theme must exist', () => {
    expect(checkReferences(map(screen))).toEqual([
      {
        code: 'FLX_DOCUMENT_MISSING',
        severity: 'error',
        path: '/records',
        message: 'the document has no "document" record',
        hint: 'add { "id": "doc", "type": "document" }',
      },
    ]);
    expect(checkReferences(map({ id: 'b', type: 'document' }, { id: 'a', type: 'document' }, screen))).toEqual([
      { code: 'FLX_DOCUMENT_DUPLICATE', severity: 'error', path: '/records/b', message: 'a document has exactly one "document" record' },
    ]);
    expect(checkReferences(map({ ...doc, themeId: 'th' }, screen))).toEqual([
      { code: 'FLX_REF_MISSING', severity: 'error', path: '/records/doc/themeId', message: 'no record "th"', hint: 'the document has no theme record' },
    ]);
    expect(checkReferences(map({ ...doc, themeId: 'th' }, screen, { id: 'th', type: 'theme' }))).toEqual([]);
    expect(checkReferences(map({ ...doc, themeId: 's1' }, screen))).toEqual([
      { code: 'FLX_REF_WRONG_TYPE', severity: 'error', path: '/records/doc/themeId', message: '"s1" is a screen, expected theme' },
    ]);
  });

  it('FR-DOC-004: a missing reference hints at up to five existing ids of the expected type, sorted', () => {
    const themes = ['t6', 't2', 't4', 't1', 't5', 't3'].map((id) => ({ id, type: 'theme' }));
    expect(checkReferences(map({ ...doc, themeId: 'x' }, screen, ...themes))[0]?.hint).toBe('existing theme ids: t1, t2, t3, t4, t5, …');
    expect(checkReferences(map({ ...doc, themeId: 'x' }, screen, ...themes.slice(0, 5)))[0]?.hint).toBe('existing theme ids: t1, t2, t4, t5, t6');
    expect(checkReferences(map({ ...doc, themeId: 'x' }, screen, { id: 't1', type: 'theme' }))[0]?.hint).toBe('existing theme ids: t1');
  });

  it('FR-DOC-004: a reference that is not a string is not checked', () => {
    expect(checkReferences(map({ ...doc, themeId: 1 }, screen))).toEqual([]);
  });

  it('FR-DOC-004: a screen checks its master, parent element, section, theme and background asset', () => {
    const s: R = { ...screen, masterId: 'm', parentElementId: 'p', sectionId: 'sec', themeId: 'th', background: { assetId: 'as' } };
    expect(checkReferences(map(doc, s)).map((d) => [d.path, d.hint])).toEqual([
      ['/records/s1/masterId', 'existing screen ids: s1'],
      ['/records/s1/parentElementId', 'the document has no element record'],
      ['/records/s1/sectionId', 'the document has no section record'],
      ['/records/s1/themeId', 'the document has no theme record'],
      ['/records/s1/background/assetId', 'the document has no asset record'],
    ]);
    const ok = { ...s, masterId: 's1', parentElementId: 'e', sectionId: 'sec', themeId: 'th', background: { assetId: 'as' } };
    expect(
      checkReferences(map(doc, ok, group('e'), { id: 'sec', type: 'section', index: 'a0' }, { id: 'th', type: 'theme' }, { id: 'as', type: 'asset' })),
    ).toEqual([]);
    expect(checkReferences(map(doc, { ...screen, background: 'red' }))).toEqual([]);
  });

  it('FR-DOC-004: an element checks its screen, assets and fill asset', () => {
    const e = group('e', { screenId: 'nope', assetId: 'a', snapshotAssetId: 'b', style: { fill: { assetId: 'c' } } });
    expect(check(e).map((d) => [d.code, d.path])).toEqual([
      ['FLX_REF_MISSING', '/records/e/screenId'],
      ['FLX_REF_MISSING', '/records/e/assetId'],
      ['FLX_REF_MISSING', '/records/e/snapshotAssetId'],
      ['FLX_REF_MISSING', '/records/e/style/fill/assetId'],
    ]);
    expect(check(group('e', { screenId: 'doc' }))[0]?.message).toBe('"doc" is a document, expected screen');
  });

  it('FR-DOC-004: a parent is an element on the same screen that can contain elements', () => {
    expect(check(group('p'), group('c', { parentId: 'p' }))).toEqual([]);
    for (const kind of ['frame', 'component', 'acme:box', 'custom']) expect(codes(group('p', { kind }), group('c', { parentId: 'p' })), kind).toEqual([]);
    for (const kind of ['shape', 'connector', 'text', 'image']) {
      const kindDiag = check(group('p', { kind, freeSource: {}, freeTarget: {} }), group('c', { parentId: 'p' }));
      expect(kindDiag, kind).toEqual([
        {
          code: 'FLX_PARENT_INVALID',
          severity: 'error',
          path: '/records/c/parentId',
          message: `a ${kind} cannot contain elements`,
          hint: 'use a group or frame as the parent',
        },
      ]);
    }
    expect(check(group('p', { kind: 1 }), group('c', { parentId: 'p' })).map((d) => d.message)).toEqual(['a 1 cannot contain elements']);
    const other: R = { id: 's2', type: 'screen', index: 'a1' };
    expect(checkReferences(map(doc, screen, other, group('p', { screenId: 's2' }), group('c', { parentId: 'p' })))).toEqual([
      { code: 'FLX_PARENT_INVALID', severity: 'error', path: '/records/c/parentId', message: 'parent "p" is on another screen' },
    ]);
    expect(codes(group('c', { parentId: 'x' }))).toEqual(['FLX_REF_MISSING']);
    expect(check(group('c', { parentId: 's1' }))[0]?.message).toBe('"s1" is a screen, expected element');
  });

  it('FR-DOC-004: a parent chain that loops back is reported on each element of the loop', () => {
    const diags = check(group('a', { parentId: 'b' }), group('b', { parentId: 'a' }), group('c', { parentId: 'a' }));
    expect(diags.filter((d) => d.code === 'FLX_PARENT_CYCLE')).toEqual([
      { code: 'FLX_PARENT_CYCLE', severity: 'error', path: '/records/a/parentId', message: 'the parent chain loops back to this element' },
      { code: 'FLX_PARENT_CYCLE', severity: 'error', path: '/records/b/parentId', message: 'the parent chain loops back to this element' },
    ]);
    expect(codes(group('a', { parentId: 'a' }))).toContain('FLX_PARENT_CYCLE');
    expect(codes(group('a', { parentId: 'b' }), group('b', { parentId: 'c' }), group('c'))).toEqual([]);
    // a chain through a record that is present but failed its schema still closes the loop
    const a = group('a', { parentId: 'b' });
    const b = group('b', { parentId: 'a' });
    expect(checkReferences(map(doc, screen, a), map(doc, screen, a, b)).map((d) => d.code)).toContain('FLX_PARENT_CYCLE');
  });

  const connector = (id: string, extra: Record<string, unknown> = {}): R => ({ id, type: 'element', kind: 'connector', screenId: 's1', index: id, ...extra });
  const binding = (id: string, end: string, extra: Record<string, unknown> = {}): R => ({
    id,
    type: 'binding',
    connectorId: 'k',
    elementId: 'g',
    end,
    ...extra,
  });

  it('FR-CON-001: a binding names a connector and another element', () => {
    expect(check(connector('k'), group('g'), binding('b1', 'source'), binding('b2', 'target'))).toEqual([]);
    expect(check(connector('k', { freeTarget: {} }), group('g'), binding('b1', 'source', { connectorId: 'g' }))).toContainEqual({
      code: 'FLX_REF_WRONG_TYPE',
      severity: 'error',
      path: '/records/b1/connectorId',
      message: '"g" is a group, not a connector',
    });
    expect(check(connector('k', { freeTarget: {} }), binding('b1', 'source', { elementId: 'k' }))).toEqual([
      { code: 'FLX_REF_WRONG_TYPE', severity: 'error', path: '/records/b1/elementId', message: 'a connector cannot bind to itself' },
    ]);
    expect(check(connector('k', { freeTarget: {} }), binding('b1', 'source', { elementId: 'x' })).map((d) => d.path)).toEqual(['/records/b1/elementId']);
    expect(check(connector('k', { freeSource: {}, freeTarget: {} }), group('g'), binding('b1', 'source', { connectorId: 'x' })).map((d) => d.path)).toEqual([
      '/records/b1/connectorId',
    ]);
  });

  it('FR-CON-001: each connector end is bound once or free, never both and never neither', () => {
    expect(check(connector('k'))).toEqual([
      {
        code: 'FLX_CONNECTOR_END_MISSING',
        severity: 'error',
        path: '/records/k/freeSource',
        message: 'the source end is neither bound nor free',
        hint: 'add a binding record or freeSource: { "x": …, "y": … }',
      },
      {
        code: 'FLX_CONNECTOR_END_MISSING',
        severity: 'error',
        path: '/records/k/freeTarget',
        message: 'the target end is neither bound nor free',
        hint: 'add a binding record or freeTarget: { "x": …, "y": … }',
      },
    ]);
    expect(check(connector('k', { freeSource: {}, freeTarget: {} }), group('g'), binding('b1', 'source'), binding('b2', 'target'))).toEqual([
      { code: 'FLX_CONNECTOR_END_CONFLICT', severity: 'warning', path: '/records/k/freeSource', message: 'the source end is bound; freeSource is ignored' },
      { code: 'FLX_CONNECTOR_END_CONFLICT', severity: 'warning', path: '/records/k/freeTarget', message: 'the target end is bound; freeTarget is ignored' },
    ]);
    expect(check(connector('k', { freeTarget: {} }), group('g'), binding('b2', 'source'), binding('b1', 'source'))).toEqual([
      { code: 'FLX_BINDING_DUPLICATE', severity: 'error', path: '/records/b2', message: 'the source end of "k" is already bound by "b1"' },
    ]);
    // a binding that failed its schema still binds its end
    const k = connector('k', { freeTarget: {} });
    expect(checkReferences(map(doc, screen, k, group('g')), map(doc, screen, k, group('g'), binding('b1', 'source')))).toEqual([]);
  });

  it('FR-DOC-004: timelines, steps, interactions and comments check what they point at', () => {
    const t: R = { id: 't', type: 'timeline', screenId: 'x', index: 'a0' };
    const st: R = { id: 'st', type: 'step', timelineId: 'x', index: 'a0' };
    const i: R = { id: 'i', type: 'interaction', ownerId: 'x' };
    const m: R = { id: 'm', type: 'comment', targetId: 'x' };
    expect(check(t, st, i, m).map((d) => [d.code, d.path, d.hint])).toEqual([
      ['FLX_REF_MISSING', '/records/t/screenId', 'existing screen ids: s1'],
      ['FLX_REF_MISSING', '/records/st/timelineId', 'existing timeline ids: t'],
      ['FLX_REF_MISSING', '/records/i/ownerId', undefined],
      ['FLX_REF_MISSING', '/records/m/targetId', undefined],
    ]);
    expect(check({ ...t, screenId: 's1' }, { ...st, timelineId: 't' }, { ...i, ownerId: 'doc' }, { ...m, targetId: 's1' })).toEqual([]);
    expect(check({ ...st, timelineId: 's1' })[0]?.message).toBe('"s1" is a screen, expected timeline');
  });

  it('FR-DOC-004: sibling indices are unique per screen and parent, per timeline, per screen of timelines', () => {
    expect(check(group('a', { index: 'x' }), group('b', { index: 'x' }))).toEqual([
      {
        code: 'FLX_INDEX_DUPLICATE',
        severity: 'warning',
        path: '/records/b/index',
        message: 'index "x" is shared with a sibling',
        hint: 'repair appends it after its siblings',
      },
    ]);
    expect(codes(group('p'), group('a', { index: 'x' }), group('b', { index: 'x', parentId: 'p' }))).toEqual([]);
    expect(codes(group('p'), group('a', { index: 'x', parentId: 'p' }), group('b', { index: 'x', parentId: 'p' }))).toEqual(['FLX_INDEX_DUPLICATE']);
    const other: R = { id: 's2', type: 'screen', index: 'a1' };
    expect(checkReferences(map(doc, screen, other, group('a', { index: 'x' }), group('b', { index: 'x', screenId: 's2' })))).toEqual([]);
    expect(codes({ id: 's2', type: 'screen', index: 'a0' })).toEqual(['FLX_INDEX_DUPLICATE']);
    expect(codes({ id: 'x1', type: 'section', index: 'a0' }, { id: 'x2', type: 'section', index: 'a0' })).toEqual(['FLX_INDEX_DUPLICATE']);
    const t = (id: string, screenId = 's1'): R => ({ id, type: 'timeline', screenId, index: 'a0' });
    expect(codes(t('t1'), t('t2'))).toEqual(['FLX_INDEX_DUPLICATE']);
    expect(checkReferences(map(doc, screen, { id: 's2', type: 'screen', index: 'a1' }, t('t1'), t('t2', 's2'))).map((d) => d.code)).toEqual([]);
    const st = (id: string, timelineId: string): R => ({ id, type: 'step', timelineId, index: 'a0' });
    expect(codes(t('t1'), { ...t('t2'), index: 'a1' }, st('p1', 't1'), st('p2', 't1'))).toEqual(['FLX_INDEX_DUPLICATE']);
    expect(codes(t('t1'), { ...t('t2'), index: 'a1' }, st('p1', 't1'), st('p2', 't2'))).toEqual([]);
    expect(codes({ id: 'c1', type: 'comment', targetId: 's1', index: 'a0' }, { id: 'c2', type: 'comment', targetId: 's1', index: 'a0' })).toEqual([]);
  });

  it('FR-DOC-004: element slugs are unique, reported after the first by id', () => {
    expect(check(group('b', { semantic: { slug: 'x' } }), group('a', { semantic: { slug: 'x' } }))).toEqual([
      { code: 'FLX_SLUG_DUPLICATE', severity: 'error', path: '/records/b/semantic/slug', message: 'slug "x" is used by another element' },
    ]);
    expect(codes(group('a', { semantic: { slug: 'x' } }), group('b', { semantic: { slug: 'y' } }), group('c', { semantic: {} }), group('d'))).toEqual([]);
    expect(codes(group('a', { semantic: { slug: 1 } }), group('b', { semantic: { slug: 1 } }))).toEqual([]);
  });

  it('FR-DOC-004: only records that passed their schemas have their own fields checked', () => {
    const bad = group('e', { screenId: 'nope' });
    expect(checkReferences(map(doc, screen), map(doc, screen, bad))).toEqual([]);
    // a reference to a present record that failed its schema is that record's problem, not a missing one
    expect(checkReferences(map(doc, screen, group('c', { parentId: 'e' })), map(doc, screen, group('e'), group('c', { parentId: 'e' })))).toEqual([]);
  });
});
