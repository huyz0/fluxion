import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkedSchema } from './checked-schema.js';
import type { RecordId } from './ids.js';
import { type Extensible, recordIdSchema } from './primitives.js';

type Point = { readonly x: number; readonly y?: number; readonly tags?: readonly string[] };
type Open = Extensible<{ readonly x: number; readonly extra?: string; readonly inner?: Extensible<{ readonly a?: number }> }>;
type Ref = Extensible<{ readonly id: RecordId }>;

const tags = z.array(z.string()).optional();

describe('checkedSchema (ADR-0140)', () => {
  it('accepts a schema whose output equals the type', () => {
    const point = checkedSchema<Point>()(z.object({ x: z.number(), y: z.number().optional(), tags }));
    expect(point.parse({ x: 1 })).toEqual({ x: 1 });
    const open = checkedSchema<Open>()(
      z.looseObject({ x: z.number(), extra: z.string().optional(), inner: z.looseObject({ a: z.number().optional() }).optional() }),
    );
    expect(open.parse({ x: 1, other: true })).toEqual({ x: 1, other: true });
    const ref = checkedSchema<Ref>()(z.looseObject({ id: recordIdSchema }));
    expect(ref.parse({ id: 'a1' })).toEqual({ id: 'a1' });
  });

  it('rejects at compile time a schema that differs from a plain type', () => {
    // each call below is a type error; the build fails if one stops being one
    // @ts-expect-error — required y vs optional y
    checkedSchema<Point>()(z.object({ x: z.number(), y: z.number(), tags }));
    // @ts-expect-error — missing field x
    checkedSchema<Point>()(z.object({ y: z.number().optional(), tags }));
    // @ts-expect-error — extra field z
    checkedSchema<Point>()(z.object({ x: z.number(), y: z.number().optional(), tags, z: z.string() }));
    // @ts-expect-error — wrong field type
    checkedSchema<Point>()(z.object({ x: z.string(), y: z.number().optional(), tags }));
    // @ts-expect-error — wrong element type in a nested array
    checkedSchema<Point>()(z.object({ x: z.number(), y: z.number().optional(), tags: z.array(z.number()).optional() }));
    expect(true).toBe(true);
  });

  it('FR-DOC-005: rejects at compile time optional drift and key-stripping objects on Extensible types (M2.6 review F1)', () => {
    const inner = z.looseObject({ a: z.number().optional() }).optional();
    const extraOnlyInSchema = z.looseObject({ x: z.number(), extra: z.string().optional(), inner, more: z.string().optional() });
    const extraOnlyInType = z.looseObject({ x: z.number(), inner });
    const innerMissing = z.looseObject({ x: z.number(), extra: z.string().optional(), inner: z.looseObject({}).optional() });
    // @ts-expect-error — optional field only in the schema
    checkedSchema<Open>()(extraOnlyInSchema);
    // @ts-expect-error — optional field only in the type
    checkedSchema<Open>()(extraOnlyInType);
    // @ts-expect-error — optional field missing one level down
    checkedSchema<Open>()(innerMissing);
    const stripping = z.object({ x: z.number(), extra: z.string().optional(), inner });
    const strippingInside = z.looseObject({ x: z.number(), extra: z.string().optional(), inner: z.object({ a: z.number().optional() }).optional() });
    // @ts-expect-error — a key-stripping z.object for an Extensible type (M2.6 r2 F1)
    checkedSchema<Open>()(stripping);
    // @ts-expect-error — a key-stripping z.object one level down
    checkedSchema<Open>()(strippingInside);
    // @ts-expect-error — a branded id field typed as a plain string
    checkedSchema<Ref>()(z.looseObject({ id: z.string() }));
    expect(true).toBe(true);
  });
});
