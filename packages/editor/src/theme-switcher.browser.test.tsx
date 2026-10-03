import { createCore, themeRecordId } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDocument } from './new-document.js';
import { ThemeSwitcher } from './theme-switcher.js';

const color = (value: string) => ({ $type: 'color', $value: value });
const THEMES = [
  { name: 'light', tokens: { color: { background: color('#ffffff') } } },
  { name: 'dark', tokens: { color: { background: color('#000000') } }, defaults: {} },
];

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

/** Choose `label` in the select named `name`, as a user does. */
async function pick(name: string, label: string) {
  const select = host.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement;
  const option = [...select.options].find((o) => o.textContent === label) as HTMLOptionElement;
  await act(async () => {
    // a native change event, the way React hears a select
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('<ThemeSwitcher> (FR-THM-004)', () => {
  it('FR-THM-004: choosing a theme sets the document theme and a screen override, and removing the override clears it', async () => {
    const core = createCore(newDocument(seededRandom(3)));
    const screen = core.store.members('byType', 'screen')[0];
    const doc = core.store.members('byType', 'document')[0];
    await act(async () => root.render(<ThemeSwitcher store={core.store} execute={core.execute} themes={THEMES} screenId={screen} />));
    // before a theme is chosen the empty option is the state; once one is, the document keeps a theme
    expect((host.querySelector('select[aria-label="Theme"] option[value=""]') as HTMLOptionElement).disabled).toBe(false);
    await pick('Theme', 'dark');
    expect((host.querySelector('select[aria-label="Theme"] option[value=""]') as HTMLOptionElement).disabled).toBe(true);
    expect((core.store.get(doc as never) as { themeId?: string }).themeId).toBe(themeRecordId('dark'));
    await pick('Screen theme', 'light');
    expect((core.store.get(screen as never) as { themeId?: string }).themeId).toBe(themeRecordId('light'));
    expect((host.querySelector('select[aria-label="Screen theme"]') as HTMLSelectElement).value).toBe(themeRecordId('light'));
    await pick('Screen theme', 'Follows the document');
    expect((core.store.get(screen as never) as { themeId?: string }).themeId).toBeUndefined();
  });

  it('FR-THM-004: no themes on offer, no switcher; a theme the host does not offer is shown as custom', async () => {
    const core = createCore(newDocument(seededRandom(4)));
    const doc = core.store.members('byType', 'document')[0];
    await act(async () => root.render(<ThemeSwitcher store={core.store} execute={core.execute} themes={[]} screenId={undefined} />));
    expect(host.querySelector('select')).toBeNull();
    core.execute('document.setTheme', { theme: { name: 'mine', tokens: THEMES[0]?.tokens } });
    await act(async () => root.render(<ThemeSwitcher store={core.store} execute={core.execute} themes={THEMES} screenId={undefined} />));
    expect(host.querySelector('select[aria-label="Theme"]')?.textContent).toContain('theme-mine (custom)');
    expect(host.querySelector('select[aria-label="Screen theme"]')).toBeNull();
    expect(doc).toBeDefined();
  });
});
