import { createRegistry, type ShapeDef } from '@fluxion/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryPanel } from './library-panel.js';

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

const def = (id: string, category: string, keywords: string[] = []): ShapeDef =>
  ({ id, category, keywords, outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 80, h: 40 } }) as unknown as ShapeDef;

function setup() {
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const d of [def('basic:rect', 'Boxes'), def('basic:cylinder', 'Boxes', ['database']), def('flow:decision', 'Flow', ['choice'])])
    shapeDefs.register(d.id, d, 'test');
  return shapeDefs;
}
const names = () => [...host.querySelectorAll('.fx-chrome-library-item')].map((i) => i.getAttribute('data-def-id'));

describe('library panel (FR-LIB-001)', () => {
  it('FR-LIB-001: shapes are listed by pack and category with a thumbnail, and a search narrows them', async () => {
    const shapeDefs = setup();
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} />));
    expect(names()).toEqual(['basic:cylinder', 'basic:rect', 'flow:decision']);
    expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['basic / Boxes', 'flow / Flow']);
    // every item draws its outline
    expect(host.querySelectorAll('.fx-chrome-library-item svg path').length).toBe(3);
    // without onPick the items are labels, not buttons
    expect(host.querySelectorAll('.fx-chrome-library-item button').length).toBe(0);
    const box = host.querySelector('input[type="search"]') as HTMLInputElement;
    const type = async (text: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (v: string) => void;
      set.call(box, text);
      await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    };
    await type('database');
    expect(names()).toEqual(['basic:cylinder']);
    expect(host.querySelector('[aria-live]')?.textContent).toBe('1 shape');
    await type('zzz');
    expect(names()).toEqual([]);
    expect(host.querySelector('[aria-live]')?.textContent).toBe('0 shapes');
  });

  it('FR-LIB-001: picking an item reports its id, and a definition registered later appears', async () => {
    const shapeDefs = setup();
    const picked: string[] = [];
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} onPick={(id) => picked.push(id)} />));
    act(() => (host.querySelector('[data-def-id="flow:decision"] button') as HTMLButtonElement).click());
    expect(picked).toEqual(['flow:decision']);
    await act(async () => void shapeDefs.register('flow:start', def('flow:start', 'Flow'), 'test'));
    expect(names()).toContain('flow:start');
  });
});
