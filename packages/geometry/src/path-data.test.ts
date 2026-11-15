import { describe, expect, it } from 'vitest';
import { parsePathData } from './path-data.js';

describe('parsePathData (ADR-0053)', () => {
  it('FR-SHP-010: reads absolute M L Q C Z into one command list per subpath', () => {
    const read = parsePathData('M0 0 L10,0 Q 10 10 5 10 C 2 10 0 8 0 5 Z M 2 2 L 3 2 3 3 Z');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual([
      [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 10, y: 0 } },
        { kind: 'Q', control: { x: 10, y: 10 }, to: { x: 5, y: 10 } },
        { kind: 'C', control1: { x: 2, y: 10 }, control2: { x: 0, y: 8 }, to: { x: 0, y: 5 } },
        { kind: 'Z' },
      ],
      [{ kind: 'M', to: { x: 2, y: 2 } }, { kind: 'L', to: { x: 3, y: 2 } }, { kind: 'L', to: { x: 3, y: 3 } }, { kind: 'Z' }],
    ]);
  });

  it('FR-SHP-010: the coordinate groups after an M draw lines, and numbers may be signed, fractional or exponent', () => {
    const read = parsePathData('M-1.5,.5 2e1 -3');
    expect(read.ok && read.value).toEqual([
      [
        { kind: 'M', to: { x: -1.5, y: 0.5 } },
        { kind: 'L', to: { x: 20, y: -3 } },
      ],
    ]);
  });

  it.each([
    ['', 'empty'],
    ['L 0 0', 'not starting with M'],
    ['M 0 0 A 1 1 0 0 1 2 2', 'another letter'],
    ['m 0 0', 'a relative letter'],
    ['M 0', 'a partial group'],
    ['M 0 0 L', 'a letter without numbers'],
    ['M 0 0 L 1e999 0', 'a non-finite number'],
    ['5 M 0 0', 'a number without a command'],
  ])('FR-SHP-010: refuses %j (%s) with PATH_DATA_INVALID', (d) => {
    const read = parsePathData(d);
    expect(read.ok ? undefined : read.error.code).toBe('PATH_DATA_INVALID');
  });
});
