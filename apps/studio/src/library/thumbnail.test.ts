import { describe, expect, it } from 'vitest';
import { THUMBNAIL_WIDTH, thumbnailPlan } from './thumbnail.js';

const screen = (id: string, index: string, extra: object = {}) => ({ id, type: 'screen', index, ...extra });
const el = (id: string, on: readonly [screenId: string, index: string], box: readonly [number, number, number, number], extra: object = {}) => ({
  id,
  type: 'element',
  kind: 'shape',
  screenId: on[0],
  index: on[1],
  transform: { x: box[0], y: box[1], w: box[2], h: box[3] },
  ...extra,
});
const byId = (...records: { id: string; [key: string]: unknown }[]) => Object.fromEntries(records.map((r) => [r.id, r]));

describe('the library thumbnail (FR-FIL-008)', () => {
  it('FR-FIL-008: the plan is the first screen scaled to the thumbnail width, keeping its aspect ratio, on its background', () => {
    const plan = thumbnailPlan(byId(screen('s2', 'b'), screen('s1', 'a', { size: { w: 1000, h: 500 }, background: '#112233' })));
    expect(plan).toMatchObject({ w: THUMBNAIL_WIDTH, h: 160, background: '#112233', boxes: [] });
  });

  it('FR-FIL-008: elements on that screen become boxes in z-order with literal fills, a neutral grey for tokens, and text as a bar', () => {
    const plan = thumbnailPlan(
      byId(
        screen('s1', 'a'),
        screen('s2', 'b'),
        el('top', ['s1', 'b'], [960, 540, 960, 540], { style: { fill: '#ff0000' } }),
        el('under', ['s1', 'a'], [0, 0, 1920, 1080], { style: { fill: { token: 'surface' } } }),
        el('words', ['s1', 'c'], [0, 0, 192, 108], { kind: 'text' }),
        el('elsewhere', ['s2', 'a'], [0, 0, 10, 10]),
      ),
    );
    expect(plan?.boxes.map((b) => [b.x, b.y, b.w, b.h, b.color, b.text])).toEqual([
      [0, 0, 320, 180, '#cbd5e1', false],
      [160, 90, 160, 90, '#ff0000', false],
      [0, 0, 32, 18, '#94a3b8', true],
    ]);
    expect(plan?.background).toBe('#ffffff');
  });

  it('FR-FIL-008: hidden and nested elements and ones without a box are left out; a gradient takes its first stop', () => {
    const plan = thumbnailPlan(
      byId(
        screen('s1', 'a', {
          background: {
            type: 'linear-gradient',
            stops: [
              { offset: 0, color: '#abcdef' },
              { offset: 1, color: '#000000' },
            ],
          },
        }),
        el('hidden', ['s1', 'a'], [0, 0, 10, 10], { hidden: true }),
        el('nested', ['s1', 'b'], [0, 0, 10, 10], { parentId: 'g' }),
        { id: 'line', type: 'element', kind: 'connector', screenId: 's1', index: 'c' },
      ),
    );
    expect(plan?.boxes).toEqual([]);
    expect(plan?.background).toBe('#abcdef');
  });

  it('FR-FIL-008: a document with no screen has no thumbnail', () => {
    expect(thumbnailPlan({})).toBeUndefined();
    expect(thumbnailPlan(byId(el('lonely', ['s1', 'a'], [0, 0, 10, 10])))).toBeUndefined();
  });
});
