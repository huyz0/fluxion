// The infographic pack as a declarative distribution (FR-LIB-007, ADR-0048, ADR-0050): pack/ holds the canonical build of the
// definitions this package exports; every definition loads from those files through the host loader and has a visual golden.
// `vitest -u` rewrites pack/ and __golden__/ from the definitions (ADR-0193); a second run then checks the rewritten files.
import { buildShapePackFiles, checkShapePackFiles, renderShapeGolden, type ShapePackDraft } from '@fluxion/sdk/testing';
import { describe, expect, it } from 'vitest';
import { infographicPack } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const NAMES: Readonly<Record<string, string>> = {
  'infographic:pie': 'Pie slice',
  'infographic:donut': 'Donut segment',
  'infographic:gauge': 'Gauge',
  'infographic:progress': 'Progress bar',
  'infographic:target': 'Target',
  'infographic:venn': 'Venn pair',
  'infographic:matrix': 'Two-by-two matrix',
  'infographic:funnel': 'Funnel',
  'infographic:funnel-layer': 'Funnel layer',
  'infographic:pyramid': 'Pyramid',
  'infographic:step-pill': 'Step pill',
  'infographic:number-badge': 'Number badge',
  'infographic:hexagon-tile': 'Hexagon tile',
  'infographic:stat-card': 'Stat card',
  'infographic:banner': 'Banner',
  'infographic:milestone': 'Milestone',
};

const DRAFT: ShapePackDraft = {
  id: 'infographic',
  version: '1.0.0',
  name: 'Infographic',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [
    {
      id: 'fluxion',
      license: 'MIT',
      attribution: 'Fluxion contributors',
      notice: 'Copyright (c) 2026 Fluxion contributors. Released under the MIT License.',
      source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork drawn for Fluxion.' },
    },
  ],
  definitions: infographicPack.shapes.map((def) => ({ name: NAMES[def.id] ?? '', def })),
};

/** Vendor and product names a generic first-party pack never carries (ADR-0050: no brand artwork or implied endorsement). */
const BRANDS = /\b(aws|amazon|azure|microsoft|gcp|google|alibaba|oracle|ibm|cisco|kubernetes|docker|apple|android|windows)\b/i;

/** Every drawn point of a golden's paths: segment ends and cubic midpoints, in the shape's own box (render writes `M L C Z`). */
function drawnPoints(svg: string): (readonly [number, number])[] {
  return [...svg.matchAll(/<path class="fx-(?:outline|decoration)" d="([^"]+)"/g)].flatMap(([, d]) => pathPoints(d ?? ''));
}

/** The segment ends and cubic midpoints of one path's data; a command's numbers may repeat it (pairs for M and L, sextuples for C). */
function pathPoints(d: string): (readonly [number, number])[] {
  const points: (readonly [number, number])[] = [];
  let at: readonly [number, number] = [0, 0];
  for (const [, op, args] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = (args ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
    const size = op === 'C' ? 6 : 2;
    for (let i = 0; i + size <= n.length; i += size) {
      if (op === 'C') points.push(cubicMiddle(at, n.slice(i, i + 6)));
      at = [n[i + size - 2] as number, n[i + size - 1] as number];
      points.push(at);
    }
  }
  return points;
}

/** The point halfway along the cubic from `at` through the controls and end in `c` (x1 y1 x2 y2 x y). */
function cubicMiddle(at: readonly [number, number], c: readonly number[]): readonly [number, number] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = c;
  return [(at[0] + 3 * x1 + 3 * x2 + x) / 8, (at[1] + 3 * y1 + 3 * y2 + y) / 8];
}

const disk = Object.fromEntries(
  Object.entries(import.meta.glob('../pack/**/*.json', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [
    path.replace('../pack/', ''),
    text,
  ]),
);
const files = buildShapePackFiles(DRAFT);

describe('the infographic declarative pack (FR-LIB-007)', () => {
  it('FR-LIB-003: every definition is named, and pack/ is the canonical build of the exported definitions', async () => {
    expect(infographicPack.shapes.length).toBeGreaterThan(0);
    expect(DRAFT.definitions.filter((d) => d.name === '').map((d) => d.def.id)).toEqual([]);
    expect(Object.keys(NAMES).sort()).toEqual(infographicPack.shapes.map((d) => d.id).sort());
    for (const [path, text] of Object.entries(files)) await expect(text).toMatchFileSnapshot(`../pack/${path}`);
    expect(Object.keys(disk).sort()).toEqual(Object.keys(files).sort());
  });

  it('FR-LIB-003, NFR-LIC-003: every definition loads from pack/ through the host loader, licensed and credited', async () => {
    const checked = await checkShapePackFiles(disk);
    if (!checked.ok) throw new Error(checked.error.map((d) => `${d.path} ${d.message}`).join('\n'));
    expect(checked.value.definitions).toEqual(infographicPack.shapes);
  });

  it('NFR-LIC-003: names, keywords and descriptions stay generic, with no vendor brand', () => {
    expect(Object.values(files).filter((text) => BRANDS.test(text))).toEqual([]);
  });

  it('FR-LIB-007: every outline and decoration stays inside its box at the default size', () => {
    const outside = infographicPack.shapes.filter((def) => {
      const { w, h } = def.defaultSize;
      return drawnPoints(renderShapeGolden(def)).some(([x, y]) => x < -0.5 || y < -0.5 || x > w + 0.5 || y > h + 0.5);
    });
    expect(outside.map((def) => def.id)).toEqual([]);
  });

  it('FR-LIB-007: every definition has a nonempty, passing visual golden', async () => {
    for (const def of infographicPack.shapes)
      await expect(renderShapeGolden(def), def.id).toMatchFileSnapshot(`../__golden__/${def.id.replace('infographic:', '')}.svg`);
  });
});
