import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from './bootstrap.js';
import { screenThemeChoice } from './screen-theme.js';
import type { ReadView } from './store.js';

const TOKENS = { color: { text: { $type: 'color', $value: '#000000' } } };

/** A document with a screen and a master screen of the same size, the screen not yet using it. */
function setup() {
  const b = documentBuilder({ seed: 5 });
  const screen = b.screen() as RecordId;
  const master = b.screen() as RecordId;
  const core = createCore(b.build());
  const get = (id: string) => core.store.get(id as RecordId) as unknown as Record<string, unknown>;
  const put = (...records: Record<string, unknown>[]) => expect(core.execute('document.applyRecords', { puts: records, deletes: [] }).ok).toBe(true);
  const theme = (name: string) => ({ id: `theme-${name}`, type: 'theme', name, tokens: TOKENS });
  const doc = core.store.members('byType', 'document')[0] as RecordId;
  return { core, screen, master, doc, get, put, theme };
}

describe('screenThemeChoice (M20.39, cp4 F2)', () => {
  it("FR-THM-004: a screen's theme is its own override, else its applied master's, else the document's", () => {
    const { core, screen, master, doc, get, put, theme } = setup();
    // none named: the document holds the choice and names none (the light theme is drawn)
    expect(screenThemeChoice(core.store, screen)).toEqual({ holder: doc, themeId: undefined });
    put(theme('doc'), { ...get(doc), themeId: 'theme-doc' });
    expect(screenThemeChoice(core.store, screen)).toEqual({ holder: doc, themeId: 'theme-doc' });
    // a master that applies names its theme: it comes before the document's
    put(theme('master'), { ...get(master), role: 'master', themeId: 'theme-master' }, { ...get(screen), masterId: master });
    expect(screenThemeChoice(core.store, screen)).toEqual({ holder: master, themeId: 'theme-master' });
    // the screen's own override comes first
    put(theme('own'), { ...get(screen), themeId: 'theme-own' });
    expect(screenThemeChoice(core.store, screen)).toEqual({ holder: screen, themeId: 'theme-own' });
    // no screen, or an id that is no screen: the document's
    expect(screenThemeChoice(core.store, undefined)).toEqual({ holder: doc, themeId: 'theme-doc' });
    expect(screenThemeChoice(core.store, 'theme-own' as RecordId)).toEqual({ holder: doc, themeId: 'theme-doc' });
  });

  it('FR-THM-004: a master that does not apply gives no theme, and a named id is returned even when it names no theme record', () => {
    const { core, screen, master, doc, get, put, theme } = setup();
    put(theme('doc'), { ...get(doc), themeId: 'theme-doc' });
    // the screen names a screen that is not a master: not applied (ADR-0054), so the document's theme
    put(theme('master'), { ...get(master), themeId: 'theme-master' }, { ...get(screen), masterId: master });
    expect(screenThemeChoice(core.store, screen)).toEqual({ holder: doc, themeId: 'theme-doc' });
    // an id with no record behind it is still the choice: the caller draws the light theme for it, as the view does
    const records = new Map<string, unknown>([
      ['s', { id: 's', type: 'screen', themeId: 'theme-gone' }],
      ['d', { id: 'd', type: 'document', themeId: 'theme-doc' }],
    ]);
    const view = {
      get: (id: string) => records.get(id),
      members: (_: string, type: string) => (type === 'document' && records.has('d') ? ['d'] : []),
    } as unknown as ReadView;
    expect(screenThemeChoice(view, 's' as RecordId)).toEqual({ holder: 's', themeId: 'theme-gone' });
    // a themeId that is not a string names nothing
    records.set('s', { id: 's', type: 'screen', themeId: 7 });
    expect(screenThemeChoice(view, 's' as RecordId)).toEqual({ holder: 'd', themeId: 'theme-doc' });
    // no document: nothing holds the choice
    records.delete('d');
    expect(screenThemeChoice(view, 's' as RecordId)).toEqual({ holder: undefined, themeId: undefined });
  });
});
