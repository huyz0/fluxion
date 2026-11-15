// FR-SHP-007: a shape's further text regions and its icon slots (ADR-0054, M19.17). A card definition like the infographic
// pack's draws its title from `text`, its body and caption from `texts`, and its icon slot from `icons`; a `texts` key naming
// the first region is not drawn.
import { createCore, type ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder, plainText } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { ScreenView } from './screen-view.js';
import { testShapeDefs } from './test-shapes.js';

/** A card as packs/infographic defines `infographic:feature-card`: three text regions and one icon slot. */
const CARD: ShapeDef = {
  id: 'test:card',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  textRegions: [
    { name: 'title', x: 0.32, y: 0.06, w: 0.62, h: 0.28 },
    { name: 'body', x: 0.06, y: 0.38, w: 0.88, h: 0.4 },
    { name: 'caption', x: 0.06, y: 0.82, w: 0.88, h: 0.14 },
  ],
  iconSlots: [{ name: 'icon', x: 0.06, y: 0.06, w: 0.2, h: 0.28 }],
  defaultSize: { w: 240, h: 180 },
};
/** A closed icon outline the slot draws. */
const STAR: ShapeDef = { id: 'test:star', outline: { path: 'M {w/2} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 24, h: 24 } };

const defs = testShapeDefs();
defs.register(CARD.id, CARD, 'test');
defs.register(STAR.id, STAR, 'test');
const registries = builtinRegistries(defs);

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

/** One card 240x180 at (100, 50) with `fields` merged in, shown at scale 1; its element node. */
async function showCard(fields: Record<string, unknown>): Promise<HTMLElement> {
  const b = documentBuilder({ seed: 1917 });
  const screenId = b.screen({ size: { w: 800, h: 600 } });
  const id = b.rect(screenId, { x: 100, y: 50, w: 240, h: 180, label: 'Fast' });
  const file = b.build();
  const records = { ...file.records, [id]: { ...(file.records[id] as object), defId: CARD.id, ...fields } } as DocumentFile['records'];
  const core = createCore({ ...file, records });
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 800, h: 600 } }} />),
  );
  return host.querySelector<HTMLElement>(`.fx-el[data-el-id="${id as RecordId}"]`) as HTMLElement;
}

describe('text regions and icon slots (FR-SHP-007)', () => {
  it('FR-SHP-007: a card shape renders three editable text regions and an icon slot', async () => {
    const el = await showCard({ texts: { body: plainText('Loads in a blink'), caption: plainText('p95 under 1 s') }, icons: { icon: { defId: STAR.id } } });
    expect(el.querySelector('.fx-label:not(.fx-region)')?.textContent).toBe('Fast');
    const body = el.querySelector<HTMLElement>('.fx-region[data-region="body"]');
    const caption = el.querySelector<HTMLElement>('.fx-region[data-region="caption"]');
    expect(body?.textContent).toBe('Loads in a blink');
    expect(caption?.textContent).toBe('p95 under 1 s');
    // each region in its own box: the body 0.06..0.94 across and 0.38..0.78 down the 240x180 card
    expect([body?.style.left, body?.style.top, body?.style.width, body?.style.height]).toEqual(['14.4px', '68.4px', '211.2px', '72px']);
    const slot = el.querySelector('svg.fx-icon-slot[data-slot="icon"]');
    // the slot 0.06..0.26 across and 0.06..0.34 down: 48 x 50.4 at (14.4, 10.8), the star filled in it
    const [x, y, w, h] = (slot?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect([x, y, w]).toEqual([0, 0, 48]);
    expect(h).toBeCloseTo(50.4, 6);
    expect(slot?.querySelector('path')?.getAttribute('d')).toMatch(/^M24 0 L48 50\.4\d* L0 50\.4\d* Z$/);
    expect((slot as SVGElement | null)?.style.left).toBe('14.4px');
  });

  it('FR-SHP-007: a region or slot the element leaves empty draws nothing, and a texts key naming the first region is not drawn', async () => {
    const el = await showCard({ texts: { title: plainText('Hidden'), caption: plainText('') } });
    expect(el.querySelectorAll('.fx-region')).toHaveLength(0);
    expect(el.querySelector('.fx-icon-slot')).toBeNull();
    expect(el.textContent).not.toContain('Hidden');
    expect(el.querySelector('.fx-label')?.textContent).toBe('Fast');
  });
});
