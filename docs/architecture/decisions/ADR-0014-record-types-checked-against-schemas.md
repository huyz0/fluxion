---
status: accepted
date: 2026-09-27
decision-makers: harness (M2.6; deviation from coding-typescript rule 7, within NFR-MNT-002 and NFR-MNT-007)
---

# ADR-0014 — Record types are written once as TSDoc'd types and checked against their Zod schemas

## Context and Problem Statement

coding-typescript rule 7 says record types are `z.infer` of the Zod schema, never
hand-duplicated. The toolchain also requires `isolatedDeclarations` (rule §1, ADR-0011) and a
TSDoc comment on every public symbol (rule 29; TypeDoc `notDocumented` and API Extractor in
`check-api`). The two collide in `@fluxion/schema`, where M2.6 starts:

- `export type Screen = z.infer<typeof screenSchema>` fails `isolatedDeclarations` (TS9010:
  `screenSchema` needs an explicit type annotation), and the explicit annotation of a Zod object
  schema is the whole `z.ZodObject<{…}>` type spelled out, which is longer than the record type.
- An inferred type carries no per-field TSDoc, so TypeDoc's `notDocumented` fails on every
  property of every record, and the published API report shows opaque `z.infer<…>` aliases.

## Decision Drivers

- One source of truth for each record's shape (the reason for rule 7): a field added to the
  schema but not the type, or the other way round, must fail the build.
- `isolatedDeclarations`, TSDoc completeness and readable API reports stay on (NFR-MNT-002,
  NFR-MNT-007).
- No build step that generates TypeScript from schemas (the pure package is compiled as is).

## Considered Options

1. **Hand-written record types with TSDoc; each Zod schema is annotated `z.ZodType<T>` and a
   compile-time equality check proves `z.infer` of the unannotated schema equals `T`.**
2. Turn off `isolatedDeclarations` for `schema` and export `z.infer` types.
3. Generate the types from the schemas with a codegen script and commit the output.

## Decision Outcome

Chosen option 1. Each record module defines the documented type, then the schema as a
module-private constant, and exports only the annotated schema:

```ts
/** A screen … @public */
export type ScreenRecord = Extensible<{ /** … */ readonly id: RecordId; … }>;
export const screenRecordSchema: z.ZodType<ScreenRecord> =
  checkedSchema<ScreenRecord>()(z.looseObject({ id: recordIdSchema, … }));
```

`checkedSchema<T>()(schema)` compiles only when the schema's parsed output and `T` are the
**same type** (an identity check, not mutual assignability) after both are normalized at every
depth: a string index signature becomes one literal `__open` key (so the `Extensible`
`[key: string]: unknown` cannot absorb an optional field present on one side only, and a
key-stripping `z.object` never matches an `Extensible` type, FR-DOC-005), `| undefined` dropped from fields (Zod adds
it to optional fields; parsed JSON never holds `undefined`; the written types use `?: T` under
`exactOptionalPropertyTypes`), and `readonly` dropped. A missing, extra, optional-vs-required or
wrongly typed field, at any depth and on either side, fails `tsc` at the call site.

coding-typescript rule 7 now allows either `z.infer` or a documented type proven equal with
`checkedSchema`, never an unchecked duplicate.

### Consequences

- Good: `isolatedDeclarations` and TSDoc completeness stay on; the API report lists readable,
  documented record types.
- Good: drift between schema and type is a type error, not a review finding.
- Bad: each field is written twice (type and schema). The equality check makes the duplication
  safe, not free; record modules stay small (one concept per file).
- Neutral: `readonly` modifiers are ignored by the check; the written types are `readonly`
  throughout (rule 14).

### Confirmation

- Every exported schema in `packages/schema/src` is built through `checkedSchema`;
  `checked-schema.test.ts` holds `@ts-expect-error` cases (required vs optional, missing, extra,
  wrong type, nested array element) that fail the typecheck if the check stops rejecting them.
- `check-api` (API Extractor + TypeDoc `notDocumented`) stays green with the record types.

## Pros and Cons of the Options

### Hand-written types checked against schemas

- Good: all gates stay on; documentation lives on the fields.
- Bad: two spellings of each field.

### No `isolatedDeclarations` in `schema`

- Good: one spelling.
- Bad: weakens a compiler flag in one package (rule 1 forbids it); the API report and TypeDoc
  still show undocumented inferred properties, so TSDoc completeness fails anyway.

### Codegen

- Good: one spelling, documented output possible from `.describe()`.
- Bad: a generator, a `--check` gate and a stale-output failure mode, for the same benefit the
  compile-time check gives.
