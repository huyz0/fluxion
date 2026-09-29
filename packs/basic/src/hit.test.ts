import { evaluateOutline, hitTestShape, outlineDistance, projectToOutline, type ShapeDef } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { basicPack } from './index.js';

/** Open outlines are strokes: they hit within this pick margin, and have no inside. */
const MARGIN = 2;

const evaluated = (def: ShapeDef) => {
  const r = evaluateOutline(def, def.defaultSize);
  if (!r.ok) throw new Error(`${def.id}: ${r.error.message}`);
  return r.value.path;
};

type Samples = { readonly inside: readonly (readonly [number, number])[]; readonly outside: readonly (readonly [number, number])[] };

/** Samples as fractions of each shape's default box, chosen from its geometry (defaults of its params). */
const SAMPLES: { readonly [id: string]: Samples } = {
  'basic:rect': {
    inside: [
      [0.05, 0.05],
      [0.95, 0.95],
    ],
    outside: [],
  },
  'basic:rounded-rect': {
    inside: [[0.5, 0.02]],
    outside: [
      [0.005, 0.005],
      [0.995, 0.995],
    ],
  },
  'basic:ellipse': {
    inside: [
      [0.5, 0.05],
      [0.05, 0.5],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.95],
    ],
  },
  'basic:triangle': {
    inside: [
      [0.5, 0.1],
      [0.1, 0.95],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.05],
    ],
  },
  'basic:diamond': {
    inside: [
      [0.5, 0.1],
      [0.1, 0.5],
    ],
    outside: [
      [0.1, 0.1],
      [0.9, 0.9],
    ],
  },
  'basic:parallelogram': {
    inside: [
      [0.9, 0.05],
      [0.1, 0.95],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.95],
    ],
  },
  'basic:trapezoid': {
    inside: [
      [0.5, 0.05],
      [0.05, 0.95],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.05],
    ],
  },
  'basic:hexagon': {
    inside: [
      [0.5, 0.05],
      [0.05, 0.5],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.95],
    ],
  },
  'basic:octagon': {
    inside: [
      [0.5, 0.05],
      [0.05, 0.5],
    ],
    outside: [
      [0.02, 0.02],
      [0.98, 0.98],
    ],
  },
  'basic:star': {
    inside: [
      [0.5, 0.05],
      [0.5, 0.5],
    ],
    outside: [
      [0.1, 0.1],
      [0.5, 0.9],
    ],
  },
  'basic:block-arrow': {
    inside: [
      [0.05, 0.5],
      [0.95, 0.5],
    ],
    outside: [
      [0.05, 0.05],
      [0.95, 0.1],
    ],
  },
  'basic:callout': {
    inside: [
      [0.05, 0.05],
      [0.25, 0.9],
    ],
    outside: [
      [0.02, 0.95],
      [0.9, 0.9],
    ],
  },
  'basic:cloud': {
    inside: [
      [0.5, 0.3],
      [0.8, 0.5],
    ],
    outside: [
      [0.02, 0.02],
      [0.98, 0.98],
    ],
  },
  'basic:cylinder': {
    inside: [
      [0.5, 0.05],
      [0.5, 0.95],
    ],
    outside: [
      [0.02, 0.02],
      [0.98, 0.98],
    ],
  },
  'basic:document': {
    inside: [
      [0.5, 0.8],
      [0.05, 0.05],
    ],
    outside: [[0.02, 0.98]],
  },
  'basic:note': {
    inside: [
      [0.05, 0.05],
      [0.9, 0.5],
    ],
    outside: [[0.98, 0.02]],
  },
  'basic:line': {
    inside: [
      [0.5, 0.5],
      [0.01, 0.5],
    ],
    outside: [[0.5, 0.1]],
  },
  'basic:polyline': {
    inside: [
      [0.35, 0],
      [0.5, 0.5],
    ],
    outside: [[0.1, 0.1]],
  },
  'basic:freehand': {
    inside: [
      [0.25, 0.2],
      [0.5, 0.5],
    ],
    outside: [[0.5, 0.1]],
  },
  'basic:text-box': { inside: [[0.05, 0.05]], outside: [] },
  'basic:image-frame': { inside: [[0.05, 0.05]], outside: [] },
};

/** Outside every box, whatever the shape. */
const AROUND: readonly (readonly [number, number])[] = [
  [-0.1, 0.5],
  [1.1, 0.5],
  [0.5, -0.1],
  [0.5, 1.1],
];

/** Rays from `from` in 24 directions land on the outline. */
/**
 * Rays from `from` in 24 directions land on the outline; from inside a closed outline every ray meets it,
 * so each point also lies on its own ray, ahead of `from` (M5.12 review F2).
 */
function expectProjectedOnOutline(id: string, path: ReturnType<typeof evaluated>, from: { x: number; y: number }, inside: boolean): void {
  for (let k = 0; k < 24; k++) {
    const dir = { x: Math.cos((2 * Math.PI * k) / 24), y: Math.sin((2 * Math.PI * k) / 24) };
    const p = projectToOutline(path, from, dir);
    const where = `${id} from ${from.x},${from.y} at ${k * 15}°`;
    expect(p, where).not.toBeNull();
    if (p === null) continue;
    expect(outlineDistance(path, p), where).toBeLessThanOrEqual(1e-6);
    if (!inside) continue;
    const [dx, dy] = [p.x - from.x, p.y - from.y];
    expect(Math.abs(dx * dir.y - dy * dir.x), `${where}: off the ray`).toBeLessThanOrEqual(1e-6);
    expect(dx * dir.x + dy * dir.y, `${where}: behind the start`).toBeGreaterThan(0);
  }
}

describe('hit-testing and projection per basic shape (FR-SHP-005)', () => {
  it('FR-SHP-005: hit-testing classifies interior and exterior samples of every basic shape', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(basicPack.shapes.map((s) => s.id).sort());
    for (const def of basicPack.shapes) {
      const path = evaluated(def);
      const { w, h } = def.defaultSize;
      const margin = path.closed ? 0 : MARGIN;
      const samples = SAMPLES[def.id] as Samples;
      for (const [fx, fy] of samples.inside) expect(hitTestShape(path, { x: fx * w, y: fy * h }, margin), `${def.id} inside ${fx},${fy}`).toBe(true);
      for (const [fx, fy] of [...samples.outside, ...AROUND])
        expect(hitTestShape(path, { x: fx * w, y: fy * h }, margin), `${def.id} outside ${fx},${fy}`).toBe(false);
    }
  });

  it('FR-SHP-005: projected points lie on the outline of every basic shape', () => {
    for (const def of basicPack.shapes) {
      const path = evaluated(def);
      const { w, h } = def.defaultSize;
      expectProjectedOnOutline(def.id, path, { x: w / 2, y: h / 2 }, path.closed);
      expectProjectedOnOutline(def.id, path, { x: -w, y: h / 3 }, false);
    }
  });
});
