import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from './bootstrap.js';
import { themeRecordId } from './theme-commands.js';

const tokens = (value: string) => ({ color: { primary: { $type: 'color', $value: value } } });
const dark = { name: 'High Contrast!', tokens: tokens('#000000') };

function setup() {
  const b = documentBuilder({ seed: 90 });
  const s1 = b.screen();
  const s2 = b.screen();
  b.rect(s1);
  const core = createCore(b.build());
  const doc = core.store.members('byType', 'document')[0] as RecordId;
  const field = (id: RecordId, key: string) => (core.store.get(id) as unknown as Record<string, unknown>)[key];
  return { core, doc, s1, s2, field };
}

describe('theme commands (FR-THM-004, ADR-0152)', () => {
  it('FR-THM-004: switching the theme is one undo step and restyles every screen', () => {
    const { core, doc, field } = setup();
    const before = core.store.toDocument();
    expect(core.execute('document.setTheme', { theme: dark }).ok).toBe(true);
    expect(themeRecordId(dark.name)).toBe('theme-high-contrast-');
    expect(field(doc, 'themeId')).toBe('theme-high-contrast-');
    expect(core.store.get('theme-high-contrast-' as RecordId)).toMatchObject({ type: 'theme', name: dark.name });
    expect(core.store.history.undoDepth).toBe(1);
    expect(core.store.history.undo().ok).toBe(true);
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-THM-004: switching back never duplicates or overwrites the theme record', () => {
    const { core, doc, field } = setup();
    core.execute('document.setTheme', { theme: dark });
    core.execute('document.setTheme', { theme: { name: 'light', tokens: tokens('#ffffff') } });
    // the user's edit of the copied theme survives choosing the pack theme again
    core.store.transact('edit', (tx) => tx.patch('theme-high-contrast-' as RecordId, { tokens: tokens('#111111') }));
    core.execute('document.setTheme', { theme: dark });
    expect(field(doc, 'themeId')).toBe('theme-high-contrast-');
    expect(core.store.members('byType', 'theme')).toHaveLength(2);
    expect(core.store.get('theme-high-contrast-' as RecordId)).toMatchObject({ tokens: tokens('#111111') });
  });

  it('FR-THM-004: a screen with an override keeps its own values', () => {
    const { core, doc, s1, s2, field } = setup();
    expect(core.execute('screen.setThemeOverride', { id: s1, theme: dark }).ok).toBe(true);
    expect(core.execute('document.setTheme', { theme: { name: 'light', tokens: tokens('#ffffff') } }).ok).toBe(true);
    expect(field(s1, 'themeId')).toBe('theme-high-contrast-');
    expect(field(s2, 'themeId')).toBeUndefined();
    expect(field(doc, 'themeId')).toBe('theme-light');
    // no theme removes the override
    expect(core.execute('screen.setThemeOverride', { id: s1 }).ok).toBe(true);
    expect(field(s1, 'themeId')).toBeUndefined();
  });

  it('FR-THM-004: the id fits a record id, and a name taken by another record type, an unknown screen are refused', () => {
    const { core } = setup();
    expect(themeRecordId('a'.repeat(80))).toHaveLength(64);
    expect(core.execute('screen.setThemeOverride', { id: 'Gone', theme: dark }).ok).toBe(false);
    core.store.transact('clash', (tx) => tx.put({ id: 'theme-x' as RecordId, type: 'section', name: 'x', index: 'a0' } as never));
    expect(core.execute('document.setTheme', { theme: { name: 'X', tokens: tokens('#000000') } }).ok).toBe(false);
    expect(core.execute('screen.setThemeOverride', { id: core.store.members('byType', 'screen')[0], theme: { name: 'X', tokens: tokens('#000000') } }).ok).toBe(
      false,
    );
  });
});

describe('document.updateMeta (FR-DOC-006)', () => {
  it('FR-DOC-006: updating metadata sets modified through the clock and is one undo step', () => {
    const { core, doc, field } = setup();
    const before = core.store.toDocument();
    const r = core.execute('document.updateMeta', {
      fields: { description: 'A deck', tags: ['a', 'b'], authors: ['Ada'], custom: { team: 'x' }, lang: 'en' },
      modified: '2026-03-04T05:06:07Z',
    });
    expect(r.ok).toBe(true);
    expect(field(doc, 'description')).toBe('A deck');
    expect(field(doc, 'custom')).toEqual({ team: 'x' });
    expect(field(doc, 'lang')).toBe('en');
    expect(field(doc, 'modified')).toBe('2026-03-04T05:06:07Z');
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-DOC-006: a modified that is not a timestamp, or a field that is not metadata, is refused', () => {
    const { core } = setup();
    expect(core.execute('document.updateMeta', { fields: {}, modified: 'yesterday' }).ok).toBe(false);
    expect(core.execute('document.updateMeta', { fields: { custom: { n: 1 } }, modified: '2026-03-04T05:06:07Z' }).ok).toBe(false);
  });
});
