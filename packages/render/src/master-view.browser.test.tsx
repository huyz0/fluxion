import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMasterLayers } from './master-view.js';
import type { RenderMode } from './mode-policy.js';
import { mastersInOrder, presentationOrder, screensInOrder } from './screen-order.js';
import { ScreenView } from './screen-view.js';
import { renderDocumentToHtml } from './ssr.js';

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

/** A 400 × 300 master (red, a logo, a `title` placeholder) and screens using it: `plain`, `own` (blue, fills the title), `bare` (hides the master's elements). */
function setup() {
  const b = documentBuilder({ seed: 2922 });
  const size = { w: 400, h: 300 };
  const master = b.screen({ name: 'Brand', size });
  const logo = b.rect(master, { x: 10, y: 10, w: 60, h: 20 });
  const title = b.rect(master, { x: 20, y: 100, w: 300, h: 50 });
  const plain = b.screen({ size });
  const mine = b.rect(plain, { x: 200, y: 200, w: 40, h: 40 });
  const own = b.screen({ size });
  const filler = b.rect(own, { x: 30, y: 110, w: 280, h: 30 });
  const bare = b.screen({ size });
  const file = b.build();
  const fields: Record<string, object> = {
    [master]: { role: 'master', background: '#ff0000' },
    [title]: { placeholder: 'title' },
    [plain]: { masterId: master },
    [own]: { masterId: master, background: '#0000ff' },
    [filler]: { fills: title },
    [bare]: { masterId: master, hideMasterElements: true },
  };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const doc = { ...file, records } as unknown as DocumentFile;
  return { doc, core: createCore(doc), master, logo, title, plain, mine, own, filler, bare };
}

type Setup = ReturnType<typeof setup>;

/** The screens `ids` of `t` drawn side by side in `mode`; each screen's root. */
async function show(t: Setup, ids: readonly RecordId[], mode: RenderMode) {
  await act(async () =>
    root.render(
      <>
        {ids.map((id) => (
          <ScreenView key={id} store={t.core.store} screenId={id} mode={mode} view={{ kind: 'fit', box: { w: 400, h: 300 } }} />
        ))}
      </>,
    ),
  );
  return (id: RecordId) => host.querySelector(`.fx-screen[data-screen-id="${id}"]`) as HTMLElement;
}

const drawn = (screen: HTMLElement) => [...screen.querySelectorAll<HTMLElement>('.fx-el')].map((e) => e.dataset['elId']);
const hints = (screen: HTMLElement) => [...screen.querySelectorAll<HTMLElement>('.fx-master-placeholder')].map((e) => e.dataset['placeholder']);
const background = (screen: HTMLElement) => getComputedStyle(screen.querySelector('.fx-background') as HTMLElement).backgroundColor;

describe('master screens render (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: a screen draws its master’s background and elements beneath its own; a placeholder never draws as an element; an unfilled one is a hint in edit mode only; the screen’s own background wins; hideMasterElements keeps the background', async () => {
    const t = setup();
    for (const mode of ['edit', 'present', 'export'] as const) {
      const screen = await show(t, [t.plain, t.own], mode);
      // the master's logo first, beneath the screen's own element; the title placeholder is not among them
      expect(drawn(screen(t.plain))).toEqual([t.logo, t.mine]);
      expect(background(screen(t.plain))).toBe('rgb(255, 0, 0)');
      expect(hints(screen(t.plain))).toEqual(mode === 'edit' ? ['title'] : []);
      // the screen's own background wins; a filled placeholder is no hint
      expect(drawn(screen(t.own))).toEqual([t.logo, t.filler]);
      expect(background(screen(t.own))).toBe('rgb(0, 0, 255)');
      expect(hints(screen(t.own))).toEqual([]);
    }
    // hideMasterElements hides the master's elements and hints, not its background
    const screen = await show(t, [t.bare], 'edit');
    expect(drawn(screen(t.bare))).toEqual([]);
    expect(hints(screen(t.bare))).toEqual([]);
    expect(background(screen(t.bare))).toBe('rgb(255, 0, 0)');
  });

  it('FR-SCR-005: a master change updates every dependent screen', async () => {
    const t = setup();
    const screen = await show(t, [t.plain, t.own, t.bare], 'present');
    const logoOn = (id: RecordId) => screen(id).querySelector(`.fx-el[data-el-id="${t.logo}"]`) as HTMLElement | null;
    expect([logoOn(t.plain)?.style.left, logoOn(t.own)?.style.left]).toEqual(['10px', '10px']);
    await act(async () => {
      t.core.store.transact('edit', (tx) => tx.patch(t.logo, { transform: { x: 50, y: 10, w: 60, h: 20 } }));
      t.core.store.transact('edit', (tx) => tx.patch(t.master, { background: '#00ff00' }));
    });
    expect([logoOn(t.plain)?.style.left, logoOn(t.own)?.style.left, logoOn(t.bare)]).toEqual(['50px', '50px', null]);
    expect([background(screen(t.plain)), background(screen(t.own)), background(screen(t.bare))]).toEqual([
      'rgb(0, 255, 0)',
      'rgb(0, 0, 255)',
      'rgb(0, 255, 0)',
    ]);
  });

  it('FR-SCR-005: moving a screen’s own element keeps its master layer as it is, so a drag redraws the element and not the master (ADR-0028 §4)', async () => {
    const t = setup();
    const seen: unknown[] = [];
    function Probe(): null {
      seen.push(useMasterLayers(t.core.store, t.plain));
      return null;
    }
    await act(async () => root.render(<Probe />));
    const before = seen.length;
    for (const x of [210, 220, 230])
      await act(async () => {
        t.core.store.transact('drag', (tx) => tx.patch(t.mine, { transform: { x, y: 200, w: 40, h: 40 } }));
      });
    expect(seen.length).toBe(before);
    // a change to what the master draws there does come through
    await act(async () => {
      t.core.store.transact('fill', (tx) => tx.patch(t.mine, { fills: t.title }));
    });
    expect(seen.length).toBe(before + 1);
    expect((seen.at(-1) as { unfilled: unknown[] }).unfilled).toEqual([]);
  });

  it('FR-SCR-005: a master is no slide: present order and export skip it, the navigator lists it apart, and a master that does not apply draws nothing', async () => {
    const t = setup();
    const view = t.core.store;
    expect(presentationOrder(view, true)).toEqual([t.plain, t.own, t.bare]);
    expect(screensInOrder(view, true)).not.toContain(t.master);
    expect(mastersInOrder(view)).toEqual([t.master]);
    const html = renderDocumentToHtml(t.doc);
    expect(html.screens).toEqual([t.plain, t.own, t.bare]);
    expect(html.html).not.toContain('data-placeholder');
    expect(html.html).toContain(`data-master-id="${t.master}"`);
    // a size mismatch: the screen draws without the master
    t.core.store.transact('edit', (tx) => tx.patch(t.plain, { size: { w: 800, h: 600 } }));
    const screen = await show(t, [t.plain], 'edit');
    expect(drawn(screen(t.plain))).toEqual([t.mine]);
    expect(hints(screen(t.plain))).toEqual([]);
    expect(background(screen(t.plain))).not.toBe('rgb(255, 0, 0)');
  });
});
