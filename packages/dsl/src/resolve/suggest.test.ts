import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editDistance, nearest, toSlug } from './suggest.js';

describe('did-you-mean (FR-DSL-006)', () => {
  it('FR-DSL-006: edit distance counts insertions, deletions, substitutions and swaps of neighbours', () => {
    expect(editDistance('db', 'db')).toBe(0);
    expect(editDistance('dbb', 'db')).toBe(1);
    expect(editDistance('rect', 'rects')).toBe(1);
    expect(editDistance('rcet', 'rect')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), (a, b) => {
        expect(editDistance(a, b)).toBe(editDistance(b, a));
        expect(editDistance(a, b)).toBeLessThanOrEqual(Math.max(a.length, b.length));
      }),
    );
  });

  it('FR-DSL-006: nearest names the closest candidate within reach, the first by order on a tie, and nothing far off', () => {
    expect(nearest('dbb', ['api', 'db', 'web'])).toBe('db');
    expect(nearest('rounded-rct', ['basic:rounded-rect', 'rounded-rect', 'rect'])).toBe('rounded-rect');
    // case is ignored when comparing, kept in the answer
    expect(nearest('API', ['api', 'apis'])).toBe('api');
    // a tie goes to the candidate listed first
    expect(nearest('ab', ['ac', 'ad'])).toBe('ac');
    // too far: a third of the word, at least 1, at most 3 edits
    expect(nearest('database', ['web', 'api'])).toBeUndefined();
    expect(nearest('x', ['y'])).toBe('y');
    expect(nearest('anything', [])).toBeUndefined();
    // the word itself is not a suggestion
    expect(nearest('db', ['db'])).toBeUndefined();
    // the reach at its edges (M12.34 review): a third of the word, so 2 edits for 6 letters and 3 for 9; never more than 3, however long
    expect(nearest('abcdef', ['abcdxx'])).toBe('abcdxx');
    expect(nearest('abcdef', ['abcxxx'])).toBeUndefined();
    expect(nearest('abcdefghi', ['abcdefxxx'])).toBe('abcdefxxx');
    expect(nearest('abcdefghi', ['abcdexxxx'])).toBeUndefined();
    expect(nearest('abcdefghijkl', ['abcdefghixxx'])).toBe('abcdefghixxx');
    expect(nearest('abcdefghijkl', ['abcdefghxxxx'])).toBeUndefined();
    expect(nearest('authentication', ['authorization'])).toBeUndefined();
    // and at least 1, however short
    expect(nearest('ab', ['ax'])).toBe('ax');
    expect(nearest('ab', ['xy'])).toBeUndefined();
  });

  it('FR-DSL-006: toSlug turns a name into a valid slug, or nothing when no letter is left', () => {
    const SLUG = /^[a-z][a-z0-9-]*$/;
    expect(toSlug('Api')).toBe('api');
    expect(toSlug('Orders DB')).toBe('orders-db');
    expect(toSlug('1web')).toBe('web');
    expect(toSlug('-a')).toBe('a');
    expect(toSlug('a__b--c-')).toBe('a-b-c');
    expect(toSlug('')).toBeUndefined();
    expect(toSlug('123')).toBeUndefined();
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (s) => {
        const slug = toSlug(s);
        if (slug !== undefined) expect(slug).toMatch(SLUG);
      }),
    );
  });
});
