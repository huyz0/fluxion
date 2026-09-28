// ADR-0144: schema and geometry share one Result shape, so core handles both with one type.
import { type GeometryError, type Result as GeometryResult, invert, type Mat2d } from '@fluxion/geometry';
import { type Result, err as schemaErr } from '@fluxion/schema';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('one Result convention across pure packages (ADR-0144)', () => {
  it('NFR-MNT-007: geometry Result is assignable to the schema Result', () => {
    expectTypeOf<GeometryResult<Mat2d>>().toEqualTypeOf<Result<Mat2d, GeometryError>>();
    const singular: Result<Mat2d, GeometryError> = invert([0, 0, 0, 0, 0, 0]);
    expect(singular).toEqual({ ok: false, error: { code: 'MATRIX_SINGULAR', message: expect.any(String) } });
    const inverted: Result<Mat2d, GeometryError> = invert([2, 0, 0, 2, 0, 0]);
    // + 0 folds -0 into 0: only the values matter here
    expect(inverted.ok && inverted.value.map((v) => v + 0)).toEqual([0.5, 0, 0, 0.5, 0, 0]);
  });

  it('NFR-MNT-007: a schema err value is a geometry Result', () => {
    const failure = schemaErr<GeometryError>({ code: 'MATRIX_SINGULAR', message: 'm' });
    expectTypeOf(failure).toMatchTypeOf<GeometryResult<never>>();
    expect(failure).toEqual({ ok: false, error: { code: 'MATRIX_SINGULAR', message: 'm' } });
  });
});
