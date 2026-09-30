import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { clickSelection, DRAG_PX, marquee, sameStyle, sameType, union } from './selection.js';

const [a, b, c] = ['a', 'b', 'c'] as [RecordId, RecordId, RecordId];

describe('selection rules (FR-EDT-004)', () => {
  it('FR-EDT-004: a click selects what it hits alone; shift toggles it; nothing clears unless shift', () => {
    expect(clickSelection([a, b], c, false)).toEqual([c]);
    expect(clickSelection([a, b], undefined, false)).toEqual([]);
    expect(clickSelection([a], b, true)).toEqual([a, b]);
    expect(clickSelection([a, b], a, true)).toEqual([b]);
    const current = [a];
    expect(clickSelection(current, undefined, true)).toBe(current);
  });

  it('FR-EDT-004: a marquee dragged rightwards contains, leftwards intersects, from its two corners', () => {
    expect(DRAG_PX).toBe(4);
    expect(marquee({ x: 10, y: 20 }, { x: 50, y: 5 })).toEqual({ box: { x: 10, y: 5, w: 40, h: 15 }, mode: 'contain' });
    expect(marquee({ x: 50, y: 5 }, { x: 10, y: 20 })).toEqual({ box: { x: 10, y: 5, w: 40, h: 15 }, mode: 'intersect' });
    expect(marquee({ x: 10, y: 5 }, { x: 10, y: 20 }).mode).toBe('contain');
    expect(union([a, b], [b, c])).toEqual([a, b, c]);
  });

  it('FR-EDT-004: same type is the kind and shape definition; same style is the element`s own style', () => {
    const d = documentBuilder({ seed: 130 });
    const s = d.screen();
    const r1 = d.rect(s, { style: { fill: '#ff0000', stroke: { width: 2, color: '#000000' } } });
    const r2 = d.rect(s, { style: { stroke: { color: '#000000', width: 2 }, fill: '#ff0000' } });
    const r3 = d.rect(s);
    const e1 = d.rect(s, { defId: 'basic:ellipse', style: { fill: '#ff0000', stroke: { width: 2, color: '#000000' } } });
    const t1 = d.text(s, 'x');
    const t2 = d.text(s, 'y');
    // as many keys as r1's but other values; one key under other names; dashes as arrays; an explicit empty style
    const green = d.rect(s, { style: { fill: '#00ff00', stroke: { width: 2, color: '#000000' } } });
    const round = d.rect(s, { style: { radius: 0.5 } as never });
    const faint = d.rect(s, { style: { opacity: 0.5 } });
    const dashed = d.rect(s, { style: { stroke: { dash: [4, 2] } } });
    const dotted = d.rect(s, { style: { stroke: { dash: [2, 4] } } });
    const long = d.rect(s, { style: { stroke: { dash: [42] } } });
    const empty = d.rect(s, { style: {} });
    const view = createCore(d.build()).store;
    const pool = [r1, r2, r3, e1, t1, t2];
    const more = [green, round, faint, dashed, dotted, long, empty, r3];
    expect(sameStyle(view, [green], [...pool, ...more])).toEqual([green]);
    expect(sameStyle(view, [round], more)).toEqual([round]);
    expect(sameStyle(view, [dashed], more)).toEqual([dashed]);
    expect(sameStyle(view, [empty], more)).toEqual([empty, r3]);
    expect(sameType(view, [r1], pool)).toEqual([r1, r2, r3]);
    expect(sameType(view, [e1, t1], pool)).toEqual([e1, t1, t2]);
    // key order does not matter; arrays and nesting compare by value
    expect(sameStyle(view, [r1], pool)).toEqual([r1, r2, e1]);
    expect(sameStyle(view, [r3], pool)).toEqual([r3, t1, t2]);
    expect(sameType(view, [], pool)).toEqual([]);
    expect(sameStyle(view, ['gone' as RecordId], pool)).toEqual([r3, t1, t2]);
    expect(sameType(view, ['gone' as RecordId], ['gone' as RecordId, r1])).toEqual(['gone']);
  });
});
