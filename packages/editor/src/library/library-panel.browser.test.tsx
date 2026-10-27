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

  it('FR-LIB-005: hidden registered definitions stay out of the listing and search', async () => {
    const shapeDefs = setup();
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} hidden={new Set(['basic:cylinder'])} />));
    expect(names().sort()).toEqual(['basic:rect', 'flow:decision']);
    expect(shapeDefs.get('basic:cylinder')).toBeDefined();
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

  it('FR-LIB-011: the Replace toggle, or a shift-click, makes a pick replace the selected shape instead of inserting', async () => {
    const shapeDefs = setup();
    const picked: string[] = [];
    const replaced: string[] = [];
    const render = (canReplace: boolean) =>
      act(async () =>
        root.render(<LibraryPanel shapeDefs={shapeDefs} onPick={(id) => picked.push(id)} onReplace={(id) => replaced.push(id)} canReplace={canReplace} />),
      );
    const toggle = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Replace selected shape') as HTMLButtonElement;
    const item = (id: string) => host.querySelector(`[data-def-id="${id}"] button`) as HTMLButtonElement;
    const click = (el: HTMLElement, shiftKey = false) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey })));
    // nothing replaceable selected: the toggle is off and disabled, a shift-click still inserts
    await render(false);
    expect(toggle().disabled).toBe(true);
    await click(item('basic:rect'), true);
    expect([picked, replaced]).toEqual([['basic:rect'], []]);
    await render(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    await click(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    await click(item('flow:decision'));
    // one pick replaced, and the toggle let go
    expect([picked, replaced]).toEqual([['basic:rect'], ['flow:decision']]);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    await click(item('basic:cylinder'));
    await click(item('basic:rect'), true);
    expect([picked, replaced]).toEqual([
      ['basic:rect', 'basic:cylinder'],
      ['flow:decision', 'basic:rect'],
    ]);
  });
});
