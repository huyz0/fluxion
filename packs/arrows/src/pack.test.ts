// The arrows pack as a declarative distribution (FR-LIB-007, ADR-0048, ADR-0050): pack/ holds the canonical build of the
// definitions this package exports; every definition loads from those files through the host loader and has a visual golden.
// `vitest -u` rewrites pack/ and __golden__/ from the definitions (ADR-0193); a second run then checks the rewritten files.
import { buildShapePackFiles, checkShapePackFiles, renderShapeGolden, type ShapePackDraft } from '@fluxion/sdk/testing';
import { describe, expect, it } from 'vitest';
import { arrowsPack } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const NAMES: Readonly<Record<string, string>> = {
  'arrows:right': 'Right arrow',
  'arrows:left': 'Left arrow',
  'arrows:up': 'Up arrow',
  'arrows:down': 'Down arrow',
  'arrows:left-right': 'Left-right arrow',
  'arrows:up-down': 'Up-down arrow',
  'arrows:quad': 'Quad arrow',
  'arrows:notched-right': 'Notched right arrow',
  'arrows:striped-right': 'Striped right arrow',
  'arrows:chevron': 'Chevron',
  'arrows:pentagon': 'Pentagon arrow',
  'arrows:bent-right': 'Bent arrow',
  'arrows:bent-up': 'Bent-up arrow',
  'arrows:u-turn': 'U-turn arrow',
  'arrows:curved-right': 'Curved right arrow',
  'arrows:circular': 'Circular arrow',
  'arrows:callout-right': 'Right arrow callout',
  'arrows:split': 'Split arrow',
};

const DRAFT: ShapePackDraft = {
  id: 'arrows',
  version: '1.0.0',
  name: 'Arrows',
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
  definitions: arrowsPack.shapes.map((def) => ({ name: NAMES[def.id] ?? '', def })),
};

/** Vendor and product names a generic first-party pack never carries (ADR-0050: no brand artwork or implied endorsement). */
const BRANDS = /\b(aws|amazon|azure|microsoft|gcp|google|alibaba|oracle|ibm|cisco|kubernetes|docker|apple|android|windows)\b/i;

const disk = Object.fromEntries(
  Object.entries(import.meta.glob('../pack/**/*.json', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [
    path.replace('../pack/', ''),
    text,
  ]),
);
const files = buildShapePackFiles(DRAFT);

describe('the arrows declarative pack (FR-LIB-007)', () => {
  it('FR-LIB-003: every definition is named, and pack/ is the canonical build of the exported definitions', async () => {
    expect(arrowsPack.shapes.length).toBeGreaterThan(0);
    expect(DRAFT.definitions.filter((d) => d.name === '').map((d) => d.def.id)).toEqual([]);
    expect(Object.keys(NAMES).sort()).toEqual(arrowsPack.shapes.map((d) => d.id).sort());
    for (const [path, text] of Object.entries(files)) await expect(text).toMatchFileSnapshot(`../pack/${path}`);
    expect(Object.keys(disk).sort()).toEqual(Object.keys(files).sort());
  });

  it('FR-LIB-003, NFR-LIC-003: every definition loads from pack/ through the host loader, licensed and credited', async () => {
    const checked = await checkShapePackFiles(disk);
    if (!checked.ok) throw new Error(checked.error.map((d) => `${d.path} ${d.message}`).join('\n'));
    expect(checked.value.definitions).toEqual(arrowsPack.shapes);
  });

  it('NFR-LIC-003: names, keywords and descriptions stay generic, with no vendor brand', () => {
    expect(Object.values(files).filter((text) => BRANDS.test(text))).toEqual([]);
  });

  it('FR-LIB-007: every definition has a nonempty, passing visual golden', async () => {
    for (const def of arrowsPack.shapes) await expect(renderShapeGolden(def), def.id).toMatchFileSnapshot(`../__golden__/${def.id.replace('arrows:', '')}.svg`);
  });
});
