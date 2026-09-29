import { describe, expect, it } from 'vitest';
import { MARKER_SIZE, markerTrim, parseMarkerDef } from './marker.js';

const open = { id: 'basic:open-arrow', path: 'M0 0 L10 5 L0 10', inset: 0, filled: false };

describe('marker definitions (FR-CON-003, FR-EXT-001)', () => {
  it('FR-CON-003: a marker definition is literal path data in its box, with an inset of 0 to 10', () => {
    expect(parseMarkerDef(open)).toEqual({ ok: true, value: open });
    expect(parseMarkerDef({ ...open, path: 'M0 5 A5 5 0 1 1 10 5 A5 5 0 1 1 0 5 Z', inset: 10, filled: true }).ok).toBe(true);
    // several strokes, each a subpath of its own; each must parse
    expect(parseMarkerDef({ ...open, path: 'M4 0 L4 10 M7 0 L7 10' }).ok).toBe(true);
    // a bad subpath is named, as its own offsets count from its start (review F2)
    const second = parseMarkerDef({ ...open, path: 'M4 0 L4 10 M7 0 Q' });
    expect(second.ok ? '' : second.error[0]?.message).toMatch(/^subpath 2: /);
    // path data may start and end with white space
    expect(parseMarkerDef({ ...open, path: ' M0 0 L10 5 ' }).ok).toBe(true);
    // all subpaths together stay within one template's segment cap (ADR-0016 item 6)
    const many = (n: number) => parseMarkerDef({ ...open, path: Array.from({ length: n }, () => 'M0 0 L1 1').join(' ') });
    expect(many(1024).ok).toBe(true);
    const over = many(1025);
    expect(over.ok ? '' : over.error[0]?.message).toBe('the marker has 1025 segments; at most 1024');
    const problems = (input: unknown) => {
      const r = parseMarkerDef(input, ['markers', 2]);
      return r.ok ? [] : r.error.map((d) => [d.code, d.path]);
    };
    expect(problems({ ...open, id: '' })).toEqual([['FLX_PACK_INVALID', '/markers/2/id']]);
    expect(problems({ ...open, inset: 11 })).toEqual([['FLX_PACK_INVALID', '/markers/2/inset']]);
    expect(problems({ ...open, inset: -1 })).toEqual([['FLX_PACK_INVALID', '/markers/2/inset']]);
    expect(problems({ ...open, filled: 'yes' })).toEqual([['FLX_PACK_INVALID', '/markers/2/filled']]);
    expect(problems({ ...open, path: '' })).toEqual([['FLX_PACK_INVALID', '/markers/2/path']]);
    // path data that does not parse, or holds expressions, is refused with its reason
    expect(problems({ ...open, path: 'L 1 2' })).toEqual([['FLX_PACK_INVALID', '/markers/2/path']]);
    const bad = parseMarkerDef({ ...open, path: 'L 1 2' });
    expect(bad.ok ? '' : bad.error[0]?.message).toMatch(/^a path template starts with/);
    const templated = parseMarkerDef({ ...open, path: 'M0 0 L{w} 5' });
    expect(templated.ok ? '' : templated.error[0]?.message).toBe('a marker path is literal path data, without {…} expressions');
    expect(problems(null)).toEqual([['FLX_PACK_INVALID', '/markers/2']]);
    // without a location, pointers start at the definition
    const bare = parseMarkerDef({ ...open, inset: 20 });
    expect(bare.ok ? '' : bare.error[0]?.path).toBe('/inset');
  });

  it('FR-CON-003: a marker trims its inset in box units of MARKER_SIZE / 10 stroke widths', () => {
    expect(MARKER_SIZE).toBe(5);
    expect(markerTrim({ ...open, inset: 8 }, 2)).toBe(8);
    expect(markerTrim({ ...open, inset: 8 }, 4)).toBe(16);
    expect(markerTrim(open, 4)).toBe(0);
    expect(markerTrim(undefined, 4)).toBe(0);
  });
});
