import { createCore } from '@fluxion/core';
import type { Router } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

/** The built-in views and the basic rectangle (render ships no shape definitions: ADR-0016). */
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

type Build = ReturnType<typeof documentBuilder>;

/** One 800x600 screen built by `build`, shown at scale 1; returns the connector's drawn line. */
async function show(build: (b: Build, screenId: RecordId) => RecordId) {
  const b = documentBuilder({ seed: 415 });
  const screenId = b.screen({ size: { w: 800, h: 600 } });
  const connectorId = build(b, screenId);
  const core = createCore(b.build());
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 800, h: 600 } }} />),
  );
  const route = () => host.querySelector<SVGPathElement>(`.fx-el[data-el-id="${connectorId}"] path.fx-route`);
  return { core, route, connectorId };
}

/** The drawn line's ends, in screen coordinates (the screen is at scale 1 with its origin at the SVG's). */
function ends(path: SVGPathElement | null) {
  const p = path as SVGPathElement;
  const [a, b] = [p.getPointAtLength(0), p.getPointAtLength(p.getTotalLength())];
  return { source: { x: a.x, y: a.y }, target: { x: b.x, y: b.y } };
}

const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(0.5);
};

describe('connector view (FR-CON-001)', () => {
  it('FR-CON-001: renders straight line between bound shapes', async () => {
    let a = '' as RecordId;
    const { core, route } = await show((b, s) => {
      a = b.rect(s, { x: 100, y: 100, w: 100, h: 50 });
      const c = b.rect(s, { x: 400, y: 300, w: 100, h: 50 });
      return b.connect(a, c);
    });
    // the centre line (150,125)→(450,325) leaves each box through its bottom/top edge
    near(ends(route()).source, { x: 187.5, y: 150 });
    // the line stops under the arrow (FR-CON-003): 7 box units of a 5-stroke-width marker at stroke 2 is 7 px back along it
    const [dx, dy] = [225 / Math.hypot(225, 150), 150 / Math.hypot(225, 150)];
    const under = { x: 412.5 - 7 * dx, y: 300 - 7 * dy };
    near(ends(route()).target, under);
    // the drawn line in screen space ends on the border and under the arrow as well
    const screen = host.querySelector('.fx-screen')?.getBoundingClientRect() as DOMRect;
    const box = route()?.getBoundingClientRect() as DOMRect;
    near({ x: box.left - screen.left, y: box.top - screen.top }, { x: 187.5, y: 150 });
    near({ x: box.right - screen.left, y: box.bottom - screen.top }, under);
    // the SVG itself has a box around the route: an empty box is not painted by Chromium (M4.21)
    const svg = route()?.ownerSVGElement?.getBoundingClientRect() as DOMRect;
    expect(svg.left).toBeLessThan(box.left);
    expect(svg.top).toBeLessThan(box.top);
    expect(svg.right).toBeGreaterThan(box.right);
    expect(svg.bottom).toBeGreaterThan(box.bottom);
    // the arrow marker sits at the target end; the stroke comes from the theme's connector defaults
    expect(route()?.getAttribute('marker-end')).toMatch(/^url\(#fx-marker-[\w-]+-end\)$/);
    expect(route()?.getAttribute('marker-start')).toBeNull();
    expect(getComputedStyle(route() as Element).stroke).toBe('rgb(51, 65, 85)');
    // moving a bound shape redraws the line
    await act(async () => {
      core.execute('element.update', { id: a, fields: { transform: { x: 100, y: 275, w: 100, h: 50 } } });
    });
    // the new centre line (150,300)→(450,325) leaves through the right edge
    near(ends(route()).source, { x: 200, y: 300 + 50 * (25 / 300) });
  });

  it('FR-CON-001: free ends draw at their points; a rotated shape clips at its rotated outline; no arrow when asked', async () => {
    const free = await show((b) => b.connect({ x: 10, y: 20 }, { x: 300, y: 20 }, { arrow: false }));
    near(ends(free.route()).source, { x: 10, y: 20 });
    near(ends(free.route()).target, { x: 300, y: 20 });
    expect(free.route()?.getAttribute('marker-end')).toBeNull();
    // a 100x100 square turned 45°: along its horizontal centre line it reaches a corner, √2·50 out
    const rotated = await show((b, s) => b.connect(b.rect(s, { x: 100, y: 100, w: 100, h: 100, rot: 45 }), { x: 500, y: 150 }));
    near(ends(rotated.route()).source, { x: 150 + 50 * Math.SQRT2, y: 150 });
  });

  it('FR-CON-001: deleting a bound shape frees the end at its centre, and the line follows', async () => {
    let a = '' as RecordId;
    const { core, route } = await show((b, s) => {
      a = b.rect(s, { x: 0, y: 0, w: 50, h: 50 });
      return b.connect(a, { x: 300, y: 300 }, { arrow: false });
    });
    near(ends(route()).source, { x: 50, y: 50 });
    await act(async () => {
      core.execute('element.delete', { ids: [a] });
    });
    near(ends(route()).source, { x: 25, y: 25 });
    near(ends(route()).target, { x: 300, y: 300 });
  });
});

describe('routers (FR-RTE-001)', () => {
  it('FR-RTE-001: a registered test:zigzag router routes connectors of that type', async () => {
    // a zigzag through the midpoint, 40 px up: no built-in draws it
    const zigzag: Router = {
      route: ({ source, target }) => [
        { kind: 'M', to: source.point },
        { kind: 'L', to: { x: (source.point.x + target.point.x) / 2, y: (source.point.y + target.point.y) / 2 - 40 } },
        { kind: 'L', to: target.point },
      ],
    };
    // a quadratic bump up then a cubic dip down: its control points reach y 100 and y 280
    const wave: Router = {
      route: ({ source, target }) => [
        { kind: 'M', to: source.point },
        { kind: 'Q', control: { x: 150, y: 100 }, to: { x: 200, y: 200 } },
        { kind: 'C', control1: { x: 230, y: 280 }, control2: { x: 270, y: 280 }, to: target.point },
      ],
    };
    const registered = [registries.routers.register('test:zigzag', zigzag, 'test'), registries.routers.register('test:wave', wave, 'test')];
    try {
      const zig = await show((b) => b.connect({ x: 100, y: 200 }, { x: 300, y: 200 }, { route: 'test:zigzag', arrow: false }));
      expect(zig.route()?.getAttribute('d')).toBe('M100 200 L200 160 L300 200');
      // the SVG box holds the whole route plus room for the stroke and markers (24 px): peak to baseline
      const box = (svg: SVGSVGElement | null | undefined) => [svg?.style.left, svg?.style.top, svg?.style.width, svg?.style.height];
      expect(box(zig.route()?.ownerSVGElement)).toEqual(['76px', '136px', '248px', '88px']);
      // and every control point of a curved route
      const curved = await show((b) => b.connect({ x: 100, y: 200 }, { x: 300, y: 200 }, { route: 'test:wave', arrow: false }));
      expect(curved.route()?.getAttribute('d')).toBe('M100 200 Q150 100 200 200 C230 280 270 280 300 200');
      expect(box(curved.route()?.ownerSVGElement)).toEqual(['76px', '76px', '248px', '228px']);
      // an unregistered type draws straight
      const plain = await show((b) => b.connect({ x: 100, y: 200 }, { x: 300, y: 200 }, { route: 'test:unknown', arrow: false }));
      expect(plain.route()?.getAttribute('d')).toBe('M100 200 L300 200');
    } finally {
      for (const r of registered) if (r.ok) r.value.dispose();
    }
  });
});

describe('connector labels (FR-CON-006)', () => {
  it('FR-CON-006: a label at t 0.5 stays at the path midpoint when the endpoints move', async () => {
    let a = '' as RecordId;
    const { core, route, connectorId } = await show((b, s) => {
      a = b.rect(s, { x: 50, y: 50, w: 100, h: 60 });
      const c = b.rect(s, { x: 500, y: 300, w: 100, h: 60 });
      return b.connect(a, c, { route: 'orthogonal', arrow: false });
    });
    const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    await act(async () => {
      core.execute('element.update', {
        id: connectorId,
        fields: {
          labels: [
            { text, position: 0.5 },
            { text, position: 0, offset: { x: 0, y: -20 } },
          ],
        },
      });
    });
    const label = (k: number) => host.querySelectorAll<HTMLElement>(`.fx-el[data-el-id="${connectorId}"] .fx-connector-label`)[k] as HTMLElement;
    /** The label's centre and the path's midpoint, in screen coordinates. */
    const centres = () => {
      const screen = host.querySelector('.fx-screen')?.getBoundingClientRect() as DOMRect;
      const box = label(0).getBoundingClientRect();
      const p = route() as SVGPathElement;
      const mid = p.getPointAtLength(p.getTotalLength() / 2);
      return { label: { x: (box.left + box.right) / 2 - screen.left, y: (box.top + box.bottom) / 2 - screen.top }, mid: { x: mid.x, y: mid.y } };
    };
    expect(label(0).textContent).toBe('Hello');
    near(centres().label, centres().mid);
    // the second label sits at the source end, 20 px above it
    const screen = host.querySelector('.fx-screen')?.getBoundingClientRect() as DOMRect;
    const second = label(1).getBoundingClientRect();
    near(
      { x: (second.left + second.right) / 2 - screen.left, y: (second.top + second.bottom) / 2 - screen.top },
      { x: ends(route()).source.x, y: ends(route()).source.y - 20 },
    );
    // moving an endpoint moves the midpoint, and the label with it
    const before = centres().mid;
    await act(async () => {
      core.execute('element.update', { id: a, fields: { transform: { x: 50, y: 400, w: 100, h: 60 } } });
    });
    expect(centres().mid).not.toEqual(before);
    near(centres().label, centres().mid);
  });
});
