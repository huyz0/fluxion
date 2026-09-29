import { describe, expect, it } from 'vitest';
import { FixedTextMeasurer } from '../testing/fakes.js';
import type { ShapeDef } from './shape-def.js';
import { fitShapeText, textRegion } from './shape-text.js';

const measurer = new FixedTextMeasurer(0.5);
const font = { family: 'Inter', size: 10 };
const plain: ShapeDef = { id: 'test:plain', outline: { path: 'M 0 0 L {w} 0 L {w} {h} Z' }, defaultSize: { w: 100, h: 100 } };
const bubble: ShapeDef = {
  ...plain,
  id: 'test:bubble',
  params: { tail: { type: 'number', min: 0, max: 0.6, default: 0.25 } },
  textRegions: [{ name: 'body', x: 0.1, y: 0, w: 0.8, h: '1 - tail' }],
};

describe('shape text regions and fitting (ADR-0018, FR-SHP-006)', () => {
  it('FR-SHP-006: the text region is the first region of the definition, or the whole box; expressions follow params', () => {
    expect(textRegion(plain, { w: 200, h: 80 })).toEqual({ ok: true, value: { x: 0, y: 0, w: 200, h: 80 } });
    expect(textRegion(bubble, { w: 200, h: 100 })).toEqual({ ok: true, value: { x: 20, y: 0, w: 160, h: 75 } });
    // the region follows the tail param (the callout of the basic pack, M5.11 review)
    expect(textRegion(bubble, { w: 200, h: 100 }, { tail: 0.5 })).toMatchObject({ value: { h: 50 } });
    const lower = { ...bubble, textRegions: [{ name: 'b', x: 0.5, y: 0.2, w: 0.5, h: 0.4 }] };
    expect(textRegion(lower, { w: 200, h: 50 })).toEqual({ ok: true, value: { x: 100, y: 10, w: 100, h: 20 } });
    const broken = { ...bubble, textRegions: [{ name: 'b', x: 0, y: 0, w: 1, h: '1 / (tail - tail)' }] };
    const r = textRegion(broken, { w: 10, h: 10 });
    expect(r.ok ? null : `${r.error.code} ${r.error.path}`).toBe('FLX_EXPR_DOMAIN /textRegions/0/h');
    const syntax = textRegion({ ...bubble, textRegions: [{ name: 'b', x: 0, y: 0, w: '(', h: 1 }] }, { w: 10, h: 10 });
    expect(syntax.ok ? null : `${syntax.error.code} ${syntax.error.path}`).toBe('FLX_EXPR_SYNTAX /textRegions/0/w');
  });

  it('FR-SHP-006: grow reports the element height the text needs in its region; never less than the current', () => {
    const paragraphs = ['one two three four five six seven eight nine ten'];
    // the body region is 0.75 of the height and 160 px wide (144 inside the padding): 2 lines of 12 px
    const grown = fitShapeText({ def: bubble, size: { w: 200, h: 40 }, paragraphs, font, fit: { mode: 'grow' } }, measurer);
    expect(grown.ok ? grown.value.lines : []).toHaveLength(2);
    const value = grown.ok ? grown.value : undefined;
    expect(value?.regionHeight).toBe(24 + 16);
    expect(value?.height).toBeCloseTo(40 / 0.75, 9);
    expect(value?.region).toEqual({ x: 20, y: 0, w: 160, h: 30 });
    // a box already tall enough keeps its height
    const roomy = fitShapeText({ def: bubble, size: { w: 200, h: 400 }, paragraphs, font, fit: { mode: 'grow' } }, measurer);
    expect(roomy.ok ? roomy.value.height : 0).toBe(400);
    // a flat box has no region height to scale by: it grows to the height the whole-box region needs
    const flat = fitShapeText({ def: plain, size: { w: 200, h: 0 }, paragraphs, font }, measurer);
    expect(flat.ok ? flat.value.height : -1).toBe(40);
    // a flat box whose region is a share of it grows by that share (M5.33 review F1): 40 px of text in 0.75
    const flatBubble = fitShapeText({ def: bubble, size: { w: 200, h: 0 }, paragraphs, font, fit: { mode: 'grow' } }, measurer);
    expect(flatBubble.ok ? flatBubble.value.height : -1).toBeCloseTo(40 / 0.75, 9);
    // a region with no height cannot hold text however tall the box: the box keeps its height
    const slit = { ...plain, textRegions: [{ name: 's', x: 0, y: 0.5, w: 1, h: 0 }] };
    const kept = fitShapeText({ def: slit, size: { w: 200, h: 60 }, paragraphs, font, fit: { mode: 'grow' } }, measurer);
    expect(kept.ok ? kept.value.height : -1).toBe(60);
    const bad = fitShapeText(
      { def: { ...bubble, textRegions: [{ name: 'b', x: 0, y: 0, w: 1, h: 'nope' }] }, size: { w: 1, h: 1 }, paragraphs, font },
      measurer,
    );
    expect(bad.ok).toBe(false);
  });
});
