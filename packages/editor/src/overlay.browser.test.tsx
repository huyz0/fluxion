import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Overlay } from './overlay.js';
import { createSession, type Session } from './session.js';

let host: HTMLElement;
let root: Root;
let session: Session;
beforeEach(() => {
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 600px;';
  document.body.append(host);
  root = createRoot(host);
  session = createSession('doc');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function setup() {
  const b = documentBuilder({ seed: 120 });
  const screen = b.screen();
  const square = b.rect(screen, { x: 100, y: 100, w: 200, h: 200 });
  const turned = b.rect(screen, { x: 400, y: 100, w: 100, h: 100, rot: 30 });
  const link = b.connect(square, turned);
  const core = createCore(b.build());
  return { core, square, turned, link };
}

const mount = async (core: ReturnType<typeof createCore>) => {
  await act(async () => root.render(<Overlay store={core.store} session={session} box={{ w: 800, h: 600 }} />));
  return host.querySelector('svg') as SVGSVGElement;
};
const handles = () => [...host.querySelectorAll('rect[data-handle]')] as SVGRectElement[];

describe('edit overlay (FR-EDT-004)', () => {
  it('FR-EDT-004: handles stay 8 px at 25 % and 400 % zoom', async () => {
    const { core, square } = setup();
    session.selection.set([square]);
    for (const z of [0.25, 4]) {
      act(() => session.camera.set({ x: 50, y: 50, z }));
      await mount(core);
      const boxes = handles().map((h) => h.getBoundingClientRect());
      expect(boxes.length).toBe(8);
      for (const r of boxes) expect([r.width, r.height]).toEqual([8, 8]);
      const rotate = (host.querySelector('circle[data-handle="rotate"]') as SVGCircleElement).getBoundingClientRect();
      expect([rotate.width, rotate.height]).toEqual([8, 8]);
      // the frame scales with the zoom: the square is 200 page units wide
      const frame = (host.querySelector('polygon.fx-chrome-frame') as SVGPolygonElement).getBoundingClientRect();
      expect(frame.width).toBeCloseTo(200 * z, 3);
    }
  });

  it('FR-EDT-004: the frame is drawn in canvas px through the camera, turned with one turned element', async () => {
    const { core, square, turned } = setup();
    session.camera.set({ x: 0, y: 0, z: 0.5 });
    session.selection.set([square]);
    const svg = await mount(core);
    expect([svg.getAttribute('class'), svg.getAttribute('width'), svg.getAttribute('aria-hidden')]).toEqual(['fx-chrome-overlay', '800', 'true']);
    expect(handles().map((h) => [h.dataset['handle'], h.getAttribute('x'), h.getAttribute('y')])[0]).toEqual(['nw', '46', '46']);
    expect(host.querySelector('polygon.fx-chrome-frame')?.getAttribute('points')).toBe('50,50 150,50 150,150 50,150');
    // the rotate handle's stem runs from the top edge's middle up to it
    const stem = host.querySelector('line.fx-chrome-frame') as SVGLineElement;
    expect([stem.getAttribute('x1'), stem.getAttribute('y1'), stem.getAttribute('x2'), stem.getAttribute('y2')]).toEqual(['100', '50', '100', '26']);
    act(() => session.selection.set([turned]));
    expect(handles()[0]?.getAttribute('transform')).toMatch(/^rotate\(30 /);
  });

  it('FR-EDT-004: hover is outlined unless selected; the marquee is drawn; nothing boxed selected draws no frame', async () => {
    const { core, square, turned, link } = setup();
    session.camera.set({ x: 0, y: 0, z: 1 });
    await mount(core);
    expect(host.querySelector('svg')?.children.length).toBe(0);
    act(() => session.hover.set(square));
    expect(host.querySelector('polygon.fx-chrome-hover')?.getAttribute('points')).toBe('100,100 300,100 300,300 100,300');
    act(() => session.selection.set([square]));
    expect(host.querySelector('polygon.fx-chrome-hover')).toBeNull();
    act(() => session.selection.set([square, turned]));
    // one upright frame around both: from the square's left to the turned one's corner, 150 - 50 (cos 30° + sin 30°) high
    expect(host.querySelector('polygon.fx-chrome-frame')?.getAttribute('points')).toMatch(/^100,81\.69/);
    expect(handles()[0]?.getAttribute('transform')).toMatch(/^rotate\(0 100 81\.69/);
    act(() => session.selection.set([link]));
    expect(host.querySelector('.fx-chrome-selection')).toBeNull();
    act(() => session.selection.set(['missing' as RecordId]));
    expect(host.querySelector('.fx-chrome-selection')).toBeNull();
    act(() => session.marquee.set({ x: 10, y: 20, w: 30, h: 40 }));
    const band = host.querySelector('rect.fx-chrome-marquee') as SVGRectElement;
    expect(['x', 'y', 'width', 'height'].map((a) => band.getAttribute(a))).toEqual(['10', '20', '30', '40']);
    // an element moved by an edit moves its frame
    act(() => session.selection.set([square]));
    act(() => {
      core.store.transact('move', (tx) => tx.patch(square, { transform: { x: 0, y: 0, w: 200, h: 200 } }));
    });
    expect(host.querySelector('polygon.fx-chrome-frame')?.getAttribute('points')).toBe('0,0 200,0 200,200 0,200');
  });

  it('FR-ARR-001: the group entered to edit its members is outlined dashed through the camera, and the outline goes when it is left', async () => {
    const { core, square, turned } = setup();
    const grouped = core.execute('element.group', { ids: [square, turned], groupId: 'EnteredGroup0001' });
    expect(grouped.ok).toBe(true);
    act(() => session.camera.set({ x: 0, y: 0, z: 2 }));
    act(() => session.selection.set([square]));
    await mount(core);
    expect(host.querySelector('.fx-chrome-entered')).toBeNull();
    act(() => session.entered.set('EnteredGroup0001' as RecordId));
    const outline = host.querySelector('polygon.fx-chrome-entered') as SVGPolygonElement;
    expect(outline).not.toBeNull();
    // the group's box is the bounds of its members, at 200 %
    const group = core.store.get('EnteredGroup0001' as RecordId) as unknown as { transform: { w: number } };
    expect(outline.getBoundingClientRect().width).toBeCloseTo(group.transform.w * 2, 3);
    act(() => session.entered.set(undefined));
    expect(host.querySelector('.fx-chrome-entered')).toBeNull();
  });

  it('FR-ARR-005: a guide is drawn through the camera, an equal-gap guide with its distance, and two alike are told apart', async () => {
    const { core } = setup();
    act(() => session.camera.set({ x: 10, y: 20, z: 2 }));
    act(() =>
      session.guides.set([
        { axis: 'x', at: 100, from: 0, to: 50, kind: 'edge' },
        { axis: 'y', at: 200, from: 0, to: 80, kind: 'gap', distance: 40 },
        { axis: 'y', at: 200, from: 10, to: 90, kind: 'gap', distance: 60 },
      ]),
    );
    await mount(core);
    const lines = [...host.querySelectorAll('[data-guide]')];
    expect(lines.length).toBe(3);
    // x guide: page x 100 -> (100 - 10) * 2 = 180 canvas px, vertical
    const vertical = host.querySelector('[data-guide="x"] line') as SVGLineElement;
    expect([vertical.getAttribute('x1'), vertical.getAttribute('x2')]).toEqual(['180', '180']);
    // labels carry the gaps, rounded
    expect([...host.querySelectorAll('.fx-chrome-guide-label')].map((t) => t.textContent)).toEqual(['40', '60']);
    expect(host.querySelector('[data-guide="x"] text')).toBeNull();
  });
});
