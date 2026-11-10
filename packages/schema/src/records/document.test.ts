import { describe, expect, it } from 'vitest';
import { documentRecordSchema } from './document.js';

describe('document record', () => {
  it('FR-DOC-001: a minimal document record validates unchanged', () => {
    expect(documentRecordSchema.parse({ id: 'doc', type: 'document' })).toEqual({ id: 'doc', type: 'document' });
  });

  it('FR-DOC-001: takes title, language, theme, settings, authors and ISO times', () => {
    const full = {
      id: 'doc',
      type: 'document',
      title: 'Checkout',
      lang: 'pt-BR',
      themeId: 'th1',
      settings: { responsive: 'reflow', reducedMotion: 'respect', lineJumps: true },
      authors: ['Ada'],
      created: '2026-09-27T10:00:00Z',
      modified: '2026-09-27T12:30:00+10:00',
      meta: { source: 'test' },
    };
    expect(documentRecordSchema.parse(full)).toEqual(full);
  });

  it('rejects a wrong type, a bad language tag, a bad time and a bad setting', () => {
    const base = { id: 'doc', type: 'document' };
    for (const bad of [
      { ...base, type: 'screen' },
      { ...base, lang: 'english language' },
      { ...base, created: 'yesterday' },
      { ...base, settings: { responsive: 'stretch' } },
      { ...base, authors: 'Ada' },
    ])
      expect(documentRecordSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('FR-DOC-005: keeps unknown keys on the record and in settings', () => {
    const parsed = documentRecordSchema.parse({ id: 'doc', type: 'document', collab: { room: 'x' }, settings: { grid: 8 } });
    expect(parsed['collab']).toEqual({ room: 'x' });
    expect(parsed.settings?.['grid']).toBe(8);
  });

  // Each field and literal is checked on its own, so a dropped bound, literal or anchor changes a
  // verdict here rather than only in a document-file test further downstream.
  const base = { id: 'doc', type: 'document' };
  const ok = (value: unknown) => documentRecordSchema.safeParse(value).success;

  it('FR-DOC-001: every optional field is optional, and each takes its own type', () => {
    const full = {
      ...base,
      description: 'd',
      tags: ['a', 'b'],
      custom: { owner: 'x' },
      source: { flux: 1, salt: 's', deferred: { '/a': 'b' } },
    };
    expect(documentRecordSchema.parse(full)).toEqual(full);
    for (const [key, value] of [
      ['title', 1],
      ['description', 1],
      ['tags', 'a'],
      ['tags', [1]],
      ['authors', [1]],
      ['custom', { owner: 1 }],
      ['custom', 'x'],
      ['themeId', ''],
      ['meta', 'x'],
      ['id', ''],
      ['type', ''],
    ] as const)
      expect(ok({ ...base, [key]: value }), `${key}=${JSON.stringify(value)}`).toBe(false);
    expect(ok({ type: 'document' })).toBe(false);
    expect(ok({ id: 'doc' })).toBe(false);
  });

  it('FR-DOC-001: a language tag is 2 to 8 letters with optional 1-to-8 alphanumeric subtags, anchored at both ends', () => {
    for (const lang of ['en', 'EN', 'abcdefgh', 'pt-BR', 'zh-Hant-TW', 'en-1', 'en-a1b2c3d4']) expect(ok({ ...base, lang }), lang).toBe(true);
    for (const lang of ['e', 'abcdefghi', 'en-', 'en-abcdefghi', '-en', ' en', 'en ', 'e1', 'en_US', 'en--US', ''])
      expect(ok({ ...base, lang }), lang).toBe(false);
  });

  it('FR-DOC-001: each setting takes only its own values', () => {
    for (const settings of [
      { responsive: 'scale' },
      { responsive: 'reflow' },
      { reducedMotion: 'respect' },
      { reducedMotion: 'ignore' },
      { lineJumps: false },
      {},
    ])
      expect(ok({ ...base, settings }), JSON.stringify(settings)).toBe(true);
    for (const settings of [{ responsive: '' }, { reducedMotion: '' }, { reducedMotion: 'always' }, { lineJumps: 'yes' }, 'scale'])
      expect(ok({ ...base, settings }), JSON.stringify(settings)).toBe(false);
  });

  it('FR-DOC-001: created and modified are ISO date-times, with or without an offset', () => {
    for (const t of ['2026-09-27T10:00:00Z', '2026-09-27T10:00:00+02:00', '2026-09-27T10:00:00.5-05:30']) {
      expect(ok({ ...base, created: t }), t).toBe(true);
      expect(ok({ ...base, modified: t }), t).toBe(true);
    }
    for (const t of ['2026-09-27', 'now', '']) {
      expect(ok({ ...base, created: t }), t).toBe(false);
      expect(ok({ ...base, modified: t }), t).toBe(false);
    }
  });

  it('FR-DOC-001: a source block names format 1, a salt and deferred entries keyed by JSON pointer', () => {
    const source = { flux: 1, salt: 's', deferred: { '/screens/0': 'x' } };
    expect(ok({ ...base, source })).toBe(true);
    expect(ok({ ...base, source: { ...source, deferred: {} } })).toBe(true);
    expect(documentRecordSchema.parse({ ...base, source: { ...source, more: 1 } }).source?.['more']).toBe(1);
    for (const bad of [
      { ...source, flux: 2 },
      { ...source, flux: '1' },
      { ...source, salt: 1 },
      { ...source, deferred: { screens: 'x' } },
      { ...source, deferred: { '/a': 1 } },
      { salt: 's', deferred: {} },
      { flux: 1, deferred: {} },
      { flux: 1, salt: 's' },
    ])
      expect(ok({ ...base, source: bad }), JSON.stringify(bad)).toBe(false);
  });
});
