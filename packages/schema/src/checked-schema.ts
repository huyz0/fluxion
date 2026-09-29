// Record types are written once with TSDoc and proven equal to their Zod schemas at compile time
// (ADR-0140): `isolatedDeclarations` cannot export `z.infer` of an unannotated schema.
import type { z } from 'zod';

/**
 * The comparable form of a type, at every depth: a string index signature becomes the literal
 * key `__open` (Extensible's `[key: string]: unknown` would otherwise absorb any optional field
 * on one side only — M2.6 review F1 — and a key-stripping `z.object` would match an Extensible
 * type — r2 F1), `undefined` dropped from fields (Zod types optional fields `?: T | undefined`,
 * parsed JSON never holds `undefined`, the written types use `?: T`), `readonly` dropped, arrays
 * compared by element. Optional-vs-required survives: it is part of the mapped key.
 *
 * @public
 */
export type NormalizedJson<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T // also branded primitives such as `string & { __brand }`
  : T extends readonly (infer U)[]
    ? NormalizedJson<U>[]
    : T extends object
      ? { -readonly [K in keyof T as string extends K ? '__open' : number extends K ? never : K]: NormalizedJson<Exclude<T[K], undefined>> }
      : T;

/**
 * Type identity (not mere assignability), so optional-only-on-one-side fields differ.
 *
 * @public
 */
export type SameType<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

/**
 * Return `schema` typed as `z.ZodType<T>`, but only compile when the schema's parsed output and
 * `T` are the same type after normalizing (readonly, undefined and index signatures): a field missing,
 * extra, optional-vs-required or of another type, at any depth and on either side, is a type error at
 * the call site. Packages that define their own JSON types (core's `ShapeDef`) prove them the same way.
 *
 * @public
 */
export const checkedSchema =
  <T>() =>
  <S extends z.ZodType>(
    schema: S & (SameType<NormalizedJson<z.output<S>>, NormalizedJson<T>> extends true ? unknown : { readonly schemaDoesNotMatchType: never }),
  ): z.ZodType<T> =>
    schema as unknown as z.ZodType<T>;
