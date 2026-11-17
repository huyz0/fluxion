import { createCore, themeRecordId } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { exportDtcg, LIGHT_THEME, type Theme, type TokenGroup, themesFromFiles } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDocument } from './new-document.js';
import { ThemeSwitcher, themeChoices } from './theme-switcher.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A theme file of the light theme renamed `name` with primary `primary`, through JSON text as a pack ships it. */
function themeFile(name: string, primary: string): unknown {
  const color: TokenGroup = { ...(LIGHT_THEME.tokens['color'] as TokenGroup), primary: { $type: 'color', $value: primary } };
  const theme: Theme = { ...LIGHT_THEME, name, tokens: { ...LIGHT_THEME.tokens, color } };
  return JSON.parse(JSON.stringify(exportDtcg(theme).file));
}

/** The labels of the select named `name`. */
const options = (name: string): string[] =>
  [...(host.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement).options].map((o) => o.textContent ?? '');

describe('the theme picker offers every pack theme (FR-THM-007)', () => {
  it('FR-THM-007: pack themes appear in the theme picker', async () => {
    const core = createCore(newDocument(seededRandom(7)));
    const screen = core.store.members('byType', 'screen')[0];
    const doc = core.store.members('byType', 'document')[0];
    // a theme pack built from theme files registers its themes, as a pack's register does (the registry holds them by `<pack>:<slug>`)
    const themes = themesFromFiles('acme', [themeFile('Ocean', '#0b6e99'), themeFile('Forest', '#2f7d3b')]);
    if (!themes.ok) throw new Error(themes.error.message);
    for (const theme of themes.value) expect(core.registries.themes.register(theme.id, theme, 'acme').ok).toBe(true);
    // and a theme of another pack under a name the first already offers is not offered twice
    core.registries.themes.register('zeta:ocean', { ...LIGHT_THEME, name: 'Ocean' }, 'zeta');

    await act(async () =>
      root.render(<ThemeSwitcher store={core.store} execute={core.execute} themes={themeChoices(core.registries.themes)} screenId={screen} />),
    );
    expect(options('Theme')).toEqual(['Default', 'Forest', 'Ocean']);
    expect(options('Screen theme')).toEqual(['Follows the document', 'Forest', 'Ocean']);

    // choosing one copies the whole theme into the document, its table styles too
    const select = host.querySelector('select[aria-label="Theme"]') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, themeRecordId('Ocean'));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((core.store.get(doc as never) as { themeId?: string }).themeId).toBe(themeRecordId('Ocean'));
    const record = core.store.get(themeRecordId('Ocean') as never) as unknown as { tokens: { color: { primary: { $value: string } } }; tableStyles?: unknown };
    expect(record.tokens.color.primary.$value).toBe('#0b6e99');
    expect(record.tableStyles).toEqual(LIGHT_THEME.tableStyles);
  });
});
