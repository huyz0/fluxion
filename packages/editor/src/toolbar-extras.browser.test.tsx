import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FontSources } from './font-picker.js';
import { newDocument } from './new-document.js';
import { createSession } from './session.js';
import { ToolbarExtras } from './toolbar-extras.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'fx-editor';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const FONTS: FontSources = { bundled: ['Fx Bundled'], upload: async () => ({ ok: false, message: 'no' }) };

describe('<ToolbarExtras> (FR-THM-004, FR-THM-008)', () => {
  it('FR-THM-008: with fonts there is a Fonts button that opens the picker in the editor box and Close closes it; without, nothing', async () => {
    const core = createCore(newDocument(seededRandom(8)));
    const session = createSession('extras');
    const show = (themes: undefined | readonly { name: string; tokens: { [key: string]: unknown } }[], fonts: FontSources | undefined) =>
      act(async () =>
        root.render(<ToolbarExtras store={core.store} execute={core.execute} session={session} screenId={undefined} themes={themes} fonts={fonts} />),
      );
    await show(undefined, undefined);
    expect(host.querySelector('button')).toBeNull();
    await show(undefined, FONTS);
    const button = host.querySelector('button[title="Fonts"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    // the dialog is drawn in the editor's own box, not inside the toolbar
    expect(host.querySelector('[role="dialog"][aria-label="Fonts"]')).not.toBeNull();
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.click();
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    // themes alone give the switcher and no Fonts button
    await show([{ name: 'light', tokens: {} }], undefined);
    expect(host.querySelector('select[aria-label="Theme"]')).not.toBeNull();
    expect(host.querySelector('button[title="Fonts"]')).toBeNull();
  });
});
