import type { ElementRecord } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { sameButPlace } from './same-but-place.js';

const box = { x: 10, y: 20, w: 100, h: 50 };
const rec = (fields: Record<string, unknown>) => ({ id: 'e', type: 'element', kind: 'shape', ...fields }) as unknown as ElementRecord;

describe('what a move changes (NFR-PERF-001)', () => {
  it('NFR-PERF-001: records equal but for their box`s x and y are the same to draw', () => {
    const a = rec({ transform: box });
    expect(sameButPlace(a, a)).toBe(true);
    expect(sameButPlace(a, rec({ transform: box }))).toBe(true);
    expect(sameButPlace(a, rec({ transform: { ...box, x: 11 } }))).toBe(true);
    expect(sameButPlace(a, rec({ transform: { ...box, x: 0, y: 0 } }))).toBe(true);
    // records without a box (connectors) compare by their fields
    expect(sameButPlace(rec({}), rec({}))).toBe(true);
  });

  it('NFR-PERF-001: a resize, turn, flip, or any other field changed is drawn again', () => {
    const a = rec({ transform: box, name: 'n' });
    for (const b of [
      rec({ transform: { ...box, w: 101 }, name: 'n' }),
      rec({ transform: { ...box, h: 51 }, name: 'n' }),
      rec({ transform: { ...box, rot: 10 }, name: 'n' }),
      rec({ transform: { ...box, flipX: true }, name: 'n' }),
      rec({ transform: box, name: 'm' }),
      rec({ transform: box }),
      rec({ transform: box, name: 'n', hidden: true }),
      // only the box's place is ignored: an x in any other field is a change
      rec({ transform: box, name: 'n', props: { x: 1 } }),
      rec({ name: 'n' }),
      rec({ transform: undefined, name: 'n' }),
    ]) {
      expect(sameButPlace(a, b)).toBe(false);
      expect(sameButPlace(b, a)).toBe(false);
    }
    expect(sameButPlace(rec({ transform: box, props: { x: 1 } }), rec({ transform: box, props: { x: 2 } }))).toBe(false);
    // the same number of fields, one swapped for another left undefined
    expect(sameButPlace(rec({ transform: box, p: undefined }), rec({ transform: box, q: undefined }))).toBe(false);
    expect(sameButPlace(rec({ transform: { ...box, p: undefined } }), rec({ transform: { ...box, q: undefined } }))).toBe(false);
  });
});
