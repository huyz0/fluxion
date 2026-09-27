import { describe, expect, it } from 'vitest';
import { documentRecordSchema } from './document.js';

describe('document record', () => {
  it('FR-DOC-001: a minimal document record validates and gets an empty title', () => {
    expect(documentRecordSchema.parse({ id: 'doc', type: 'document' })).toEqual({ id: 'doc', type: 'document', title: '' });
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
});
