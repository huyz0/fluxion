import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

const registries = testRegistries();

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

/** Show the screen `screenId` of `store` in a 960x540 box. */
async function show(props: { box: { w: number; h: number }; screenId: RecordId; store: ReturnType<typeof createCore>['store'] }) {
  await act(async () =>
    root.render(<ScreenView registries={registries} store={props.store} screenId={props.screenId} mode="present" view={{ kind: 'fit', box: props.box }} />),
  );
}

describe("a screen's theme (FR-THM-004, ADR-0152)", () => {
  it("FR-THM-004: a screen is drawn with its own theme, else the document's, else the light theme", async () => {
    const b = documentBuilder({ seed: 401 });
    const first = b.screen();
    const second = b.screen();
    const core = createCore(b.build());
    const paint = (name: string, color: string) => ({
      id: `theme-${name}`,
      type: 'theme' as const,
      name,
      tokens: { color: { primary: { $type: 'color', $value: color } } },
    });
    const primary = async (screenId: RecordId) => {
      await show({ store: core.store, screenId, box: { w: 960, h: 540 } });
      return getComputedStyle(host.querySelector('.fx-screen') as HTMLElement)
        .getPropertyValue('--fx-color-primary')
        .trim();
    };
    const light = await primary(first);
    // no theme record anywhere: the built-in light theme
    expect(light).toBe((LIGHT_THEME.tokens['color'] as unknown as { primary: { $value: string } }).primary.$value);
    await act(async () => {
      core.execute('document.setTheme', { theme: { name: 'doc', tokens: paint('doc', '#ff0000').tokens } });
      core.execute('screen.setThemeOverride', { id: second, theme: { name: 'own', tokens: paint('own', '#00ff00').tokens } });
    });
    expect(await primary(first)).toBe('#ff0000');
    expect(await primary(second)).toBe('#00ff00');
    await act(async () => {
      core.execute('screen.setThemeOverride', { id: second });
    });
    expect(await primary(second)).toBe('#ff0000');
  });

  it('FR-THM-004: a theme record that is not a theme is drawn as the light theme, not half styled', async () => {
    const b = documentBuilder({ seed: 402 });
    const screenId = b.screen();
    // an unchecked store holds the broken record a hand-edited file could carry
    const core = createCore(b.build(), { validate: false });
    const light = getComputedStyle(
      await (async () => (await show({ store: core.store, screenId, box: { w: 960, h: 540 } }), host.querySelector('.fx-screen') as HTMLElement))(),
    )
      .getPropertyValue('--fx-color-primary')
      .trim();
    await act(async () => {
      core.store.transact('break', (tx) => {
        tx.put({ id: 'theme-bad', type: 'theme', name: 'bad', tokens: 'nope' } as never);
        tx.patch(screenId, { themeId: 'theme-bad' });
      });
    });
    expect(
      getComputedStyle(host.querySelector('.fx-screen') as HTMLElement)
        .getPropertyValue('--fx-color-primary')
        .trim(),
    ).toBe(light);
  });
});
