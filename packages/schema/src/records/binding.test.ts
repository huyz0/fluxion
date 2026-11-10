import { describe, expect, it } from 'vitest';
import { anchorRefSchema, bindingRecordSchema } from './binding.js';

// Each field, literal and bound of the binding schemas is checked here, so a changed literal or
// bound changes a verdict in this file rather than only in a document test further downstream.
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe('anchor references (FR-ANC-001, FR-ANC-002, FR-ANC-004)', () => {
  it('FR-ANC-004 FR-ANC-001: auto and floating take only their kind, and keep unknown keys', () => {
    expect(anchorRefSchema.parse({ kind: 'auto' })).toEqual({ kind: 'auto' });
    expect(anchorRefSchema.parse({ kind: 'floating', hint: 1 })).toEqual({ kind: 'floating', hint: 1 });
    for (const kind of ['', 'Auto', 'float', 'none']) expect(ok(anchorRefSchema, { kind }), kind).toBe(false);
    expect(ok(anchorRefSchema, {})).toBe(false);
  });

  it('FR-ANC-002: a named anchor needs a non-empty name', () => {
    expect(anchorRefSchema.parse({ kind: 'named', name: 'in' })).toEqual({ kind: 'named', name: 'in' });
    expect(ok(anchorRefSchema, { kind: 'named', name: 'a' })).toBe(true);
    expect(ok(anchorRefSchema, { kind: 'named', name: '' })).toBe(false);
    expect(ok(anchorRefSchema, { kind: 'named' })).toBe(false);
    expect(ok(anchorRefSchema, { kind: 'named', name: 3 })).toBe(false);
  });

  it('FR-ANC-002: a side anchor names one of the four sides and an optional position from 0 to 1', () => {
    for (const side of ['n', 'e', 's', 'w']) expect(ok(anchorRefSchema, { kind: 'side', side }), side).toBe(true);
    for (const side of ['', 'x', 'N', 'north']) expect(ok(anchorRefSchema, { kind: 'side', side }), side).toBe(false);
    expect(ok(anchorRefSchema, { kind: 'side' })).toBe(false);
    for (const t of [0, 0.5, 1]) expect(ok(anchorRefSchema, { kind: 'side', side: 'n', t }), String(t)).toBe(true);
    for (const t of [-0.01, 1.01, '0.5']) expect(ok(anchorRefSchema, { kind: 'side', side: 'n', t }), String(t)).toBe(false);
  });

  it('FR-ANC-002: a point anchor needs x and y, each from 0 to 1', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [0.25, 0.75],
    ])
      expect(ok(anchorRefSchema, { kind: 'point', x, y }), `${x},${y}`).toBe(true);
    for (const [x, y] of [
      [-0.01, 0.5],
      [1.01, 0.5],
      [0.5, -0.01],
      [0.5, 1.01],
    ])
      expect(ok(anchorRefSchema, { kind: 'point', x, y }), `${x},${y}`).toBe(false);
    expect(ok(anchorRefSchema, { kind: 'point', x: 0.5 })).toBe(false);
    expect(ok(anchorRefSchema, { kind: 'point', y: 0.5 })).toBe(false);
  });
});

describe('the binding record (FR-CON-001)', () => {
  const base = { id: 'b1', type: 'binding', connectorId: 'c1', end: 'source', elementId: 'e1', anchor: { kind: 'auto' } };

  it('FR-CON-001: a complete binding validates unchanged, with metadata and unknown keys kept', () => {
    expect(bindingRecordSchema.parse(base)).toEqual(base);
    const full = { ...base, end: 'target', meta: { by: 'test' }, extra: true };
    expect(bindingRecordSchema.parse(full)).toEqual(full);
  });

  it('FR-CON-001: every required field is required, and each takes only its own values', () => {
    for (const key of ['id', 'type', 'connectorId', 'end', 'elementId', 'anchor']) {
      const { [key]: _gone, ...rest } = base as Record<string, unknown>;
      expect(ok(bindingRecordSchema, rest), key).toBe(false);
    }
    for (const [key, value] of [
      ['type', 'connector'],
      ['type', ''],
      ['end', 'middle'],
      ['end', ''],
      ['id', ''],
      ['connectorId', ''],
      ['elementId', ''],
      ['anchor', { kind: 'side', side: 'q' }],
      ['meta', 'note'],
    ] as const)
      expect(ok(bindingRecordSchema, { ...base, [key]: value }), `${key}=${JSON.stringify(value)}`).toBe(false);
  });
});
