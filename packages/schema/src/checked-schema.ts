// Record types are written once with TSDoc and proven equal to their Zod schemas at compile time
// (ADR-0014): `isolatedDeclarations` cannot export `z.infer` of an unannotated schema.
import type { z } from 'zod';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * The comparable form of a type, at every depth: a string index signature becomes the literal
 * key `__open` (Extensible's `[key: string]: unknown` would otherwise absorb any optional field
 * on one side only — M2.6 review F1 — and a key-stripping `z.object` would match an Extensible
 * type — r2 F1), `undefined` dropped from fields (Zod types optional fields `?: T | undefined`,
 * parsed JSON never holds `undefined`, the written types use `?: T`), `readonly` dropped, arrays
 * compared by element. Optional-vs-required survives: it is part of the mapped key.
 */
type Normalize<T> = T extends Primitive
  ? T // also branded primitives such as `string & { __brand }`
  : T extends readonly (infer U)[]
    ? Normalize<U>[]
    : T extends object
      ? { -readonly [K in keyof T as string extends K ? '__open' : number extends K ? never : K]: Normalize<Exclude<T[K], undefined>> }
      : T;

/** Type identity (not mere assignability), so optional-only-on-one-side fields differ. */
type Same<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

/**
 * Return `schema` typed as `z.ZodType<T>`, but only compile when the schema's parsed output and
 * `T` are the same type after {@link Normalize}: a field missing, extra, optional-vs-required or
 * of another type, at any depth and on either side, is a type error at the call site.
 */
export const checkedSchema =
  <T>() =>
  <S extends z.ZodType>(
    schema: S & (Same<Normalize<z.output<S>>, Normalize<T>> extends true ? unknown : { readonly schemaDoesNotMatchType: never }),
  ): z.ZodType<T> =>
    schema as unknown as z.ZodType<T>;
