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

/** A screen with a plain rect and one set to `variant`, shown at scale 1. */
async function show(variant: string) {
  const b = documentBuilder({ seed: 506 });
  const screenId = b.screen({ size: { w: 800, h: 600 } });
  const plain = b.rect(screenId, { x: 0, y: 0, w: 200, h: 100, label: 'Plain' });
  const varied = b.rect(screenId, { x: 300, y: 0, w: 200, h: 100, label: 'Varied', style: { variant } });
  const core = createCore(b.build());
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 800, h: 600 } }} />),
  );
  return { core, plain: plain as RecordId, varied: varied as RecordId };
}

const outline = (id: string) => getComputedStyle(host.querySelector(`.fx-el[data-el-id="${id}"] path.fx-outline`) as Element);
const label = (id: string) => getComputedStyle(host.querySelector(`.fx-el[data-el-id="${id}"] .fx-label`) as Element);

describe('variant styles in the view (FR-THM-006, ADR-0055)', () => {
  it('FR-THM-006: variant emphasis renders the themed style', async () => {
    const { plain, varied } = await show('emphasis');
    // the light theme's emphasis: secondary fill and outline at the thick stroke, bold text on the background colour
    expect([outline(varied).fill, outline(varied).stroke, outline(varied).strokeWidth]).toEqual(['rgb(124, 58, 237)', 'rgb(124, 58, 237)', '4px']);
    expect([label(varied).color, label(varied).fontWeight]).toEqual(['rgb(255, 255, 255)', '700']);
    // a shape without a variant keeps the kind's defaults
    expect([outline(plain).fill, outline(plain).strokeWidth, label(plain).fontWeight]).toEqual(['rgb(248, 250, 252)', '2px', '400']);
  });

  it('FR-THM-006: a theme edit restyles a variant element with no element change', async () => {
    const { core, varied } = await show('emphasis');
    const own = { name: 'Edited', tokens: LIGHT_THEME.tokens, defaults: LIGHT_THEME.defaults } as never;
    await act(async () => void core.execute('document.setTheme', { theme: own }));
    expect(outline(varied).fill).toBe('rgb(124, 58, 237)');
    const element = core.store.get(varied);
    const doc = core.store.get(core.store.members('byType', 'document')[0] as RecordId) as unknown as { themeId: RecordId };
    // a theme edit: the theme record's secondary colour changes, and nothing else
    const tokens = { ...LIGHT_THEME.tokens, color: { ...(LIGHT_THEME.tokens['color'] as object), secondary: { $type: 'color', $value: '#ff0000' } } };
    await act(async () => void core.store.transact('edit theme', (tx) => tx.patch(doc.themeId, { tokens } as never)));
    expect(outline(varied).fill).toBe('rgb(255, 0, 0)');
    expect(outline(varied).strokeWidth).toBe('4px');
    expect(core.store.get(varied)).toBe(element);
  });
});
