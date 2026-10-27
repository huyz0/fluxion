// The basic pack as a declarative distribution (FR-LIB-007, ADR-0048, ADR-0050): pack/ holds the canonical build of the
// definitions this package exports; every definition loads from those files through the host loader and has a visual golden.
// `vitest -u` rewrites pack/ and __golden__/ from the definitions (ADR-0193); a second run then checks the rewritten files.
import { buildShapePackFiles, checkShapePackFiles, renderShapeGolden, type ShapePackDraft } from '@fluxion/sdk/testing';
import { describe, expect, it } from 'vitest';
import { basicPack } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const NAMES: Readonly<Record<string, string>> = {
  'basic:rect': 'Rectangle',
  'basic:rounded-rect': 'Rounded rectangle',
  'basic:ellipse': 'Ellipse',
  'basic:triangle': 'Triangle',
  'basic:diamond': 'Diamond',
  'basic:parallelogram': 'Parallelogram',
  'basic:trapezoid': 'Trapezoid',
  'basic:hexagon': 'Hexagon',
  'basic:octagon': 'Octagon',
  'basic:star': 'Star',
  'basic:block-arrow': 'Block arrow',
  'basic:callout': 'Callout',
  'basic:cloud': 'Cloud',
  'basic:cylinder': 'Cylinder',
  'basic:document': 'Document',
  'basic:note': 'Note',
  'basic:line': 'Line',
  'basic:polyline': 'Polyline',
  'basic:freehand': 'Freehand',
  'basic:text-box': 'Text box',
  'basic:image-frame': 'Image frame',
};

const DRAFT: ShapePackDraft = {
  id: 'basic',
  version: '1.0.0',
  name: 'Basic shapes',
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
  definitions: basicPack.shapes.map((def) => ({ name: NAMES[def.id] ?? '', def })),
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

describe('the basic declarative pack (FR-LIB-007)', () => {
  it('FR-LIB-003: every definition is named, and pack/ is the canonical build of the exported definitions', async () => {
    expect(basicPack.shapes.length).toBeGreaterThan(0);
    expect(DRAFT.definitions.filter((d) => d.name === '').map((d) => d.def.id)).toEqual([]);
    expect(Object.keys(NAMES).sort()).toEqual(basicPack.shapes.map((d) => d.id).sort());
    for (const [path, text] of Object.entries(files)) await expect(text).toMatchFileSnapshot(`../pack/${path}`);
    expect(Object.keys(disk).sort()).toEqual(Object.keys(files).sort());
  });

  it('FR-LIB-003, NFR-LIC-003: every definition loads from pack/ through the host loader, licensed and credited', async () => {
    const checked = await checkShapePackFiles(disk);
    if (!checked.ok) throw new Error(checked.error.map((d) => `${d.path} ${d.message}`).join('\n'));
    expect(checked.value.definitions).toEqual(basicPack.shapes);
  });

  it('NFR-LIC-003: names, keywords and descriptions stay generic, with no vendor brand', () => {
    expect(Object.values(files).filter((text) => BRANDS.test(text))).toEqual([]);
  });

  it('FR-LIB-007: every definition has a nonempty, passing visual golden', async () => {
    for (const def of basicPack.shapes) await expect(renderShapeGolden(def), def.id).toMatchFileSnapshot(`../__golden__/${def.id.replace('basic:', '')}.svg`);
  });
});
