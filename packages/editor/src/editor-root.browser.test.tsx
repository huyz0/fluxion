import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorRoot } from './editor-root.js';
import { newDocument } from './new-document.js';

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

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe('edit-mode root (FR-EDT-001)', () => {
  it('FR-EDT-001: the editor shows the first screen on a named canvas, hidden screens included', async () => {
    const core = createCore(newDocument(seededRandom(3)));
    await act(async () => root.render(<EditorRoot store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const canvas = host.querySelector('main[aria-label="Canvas"]');
    expect(canvas).not.toBeNull();
    const screen = canvas?.querySelector('.fx-screen') as HTMLElement;
    const box = screen.getBoundingClientRect();
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
    // edit mode: the screen is not interactive content
    expect(screen.hasAttribute('data-interactive')).toBe(false);
    // a hidden first screen is still edited
    const b = documentBuilder({ seed: 65 });
    const hidden = b.screen({ size: { w: 800, h: 600 } });
    const doc = b.build();
    const withHidden = createCore({ ...doc, records: { ...doc.records, [hidden]: { ...(doc.records[hidden] as object), hidden: true } } } as typeof doc);
    await act(async () => root.render(<EditorRoot store={withHidden.store} registries={renderRegistriesFor(withHidden.registries)} />));
    await act(frame);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(hidden);
  });
});
