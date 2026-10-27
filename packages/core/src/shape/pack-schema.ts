import { checkedSchema, qualifiedNameSchema } from '@fluxion/schema';
import { z } from 'zod';
import type { ShapePackIndex11, ShapePackSubset11 } from './pack-font-types.js';
import type { ShapePackCategory, ShapePackIndex, ShapePackSubset } from './pack-types.js';
import { shapeDefSchema } from './shape-def.js';

const text = z.string().regex(/\S/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/,
  );
const source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('original'), author: text, statement: text }),
  z.strictObject({ kind: z.literal('upstream'), reference: text, sha256: hash, revision: text.optional(), modifications: text.optional() }),
]);
const credit = z.strictObject({
  id: text,
  license: text,
  attribution: text,
  notice: text,
  source,
  definitionIds: z.array(qualifiedNameSchema).min(1).optional(),
});
const categoryEntry = z.strictObject({ path: text, sha256: hash });
const categories = z
  .unknown()
  .refine((v) => !(typeof v === 'object' && v !== null && Object.hasOwn(v, '__proto__')), 'reserved category key')
  .pipe(z.record(slug, categoryEntry));
const definitionEntry = z.strictObject({ id: qualifiedNameSchema, name: text, keywords: z.array(text), category: slug });

/** Structural index schema; membership and license policy still require parseShapePackIndex. @public */
export const shapePackIndexSchema: z.ZodType<ShapePackIndex> = checkedSchema<ShapePackIndex>()(
  z.strictObject({
    format: z.literal('fluxion-shape-pack'),
    formatVersion: z.literal('1.0'),
    id: slug,
    version,
    name: text,
    license: text,
    attribution: text,
    categories,
    definitions: z.array(definitionEntry).min(1),
    credits: z.array(credit).min(1),
  }),
);

/** Structural category schema; membership and license policy still require parseShapePackCategory. @public */
export const shapePackCategorySchema: z.ZodType<ShapePackCategory> = checkedSchema<ShapePackCategory>()(
  z.strictObject({
    formatVersion: z.literal('1.0'),
    definitions: z.array(shapeDefSchema).min(1),
  }),
);

/** Header parsed before individual definitions receive the existing parser's diagnostics. @internal */
export const categoryEnvelopeSchema: z.ZodType<{ formatVersion: '1.0'; definitions: unknown[] }> = z.strictObject({
  formatVersion: z.literal('1.0'),
  definitions: z.array(z.unknown()).min(1),
});

const subsetHeader = {
  format: z.literal('fluxion-shape-pack'),
  formatVersion: z.literal('1.0'),
  id: slug,
  version,
  license: text,
  attribution: text,
  credits: z.array(credit).min(1),
};

/** Structural saved-subset schema; geometry and credit semantics require parseShapePackSubset. @public */
export const shapePackSubsetSchema: z.ZodType<ShapePackSubset> = checkedSchema<ShapePackSubset>()(
  z.strictObject({ ...subsetHeader, definitions: z.array(shapeDefSchema).min(1) }),
);

type SubsetEnvelope = Omit<ShapePackSubset, 'definitions'> & { definitions: unknown[] };
/** Parse saved metadata before validating individual geometry with indexed diagnostics. @internal */
export const subsetEnvelopeSchema: z.ZodType<SubsetEnvelope> = checkedSchema<SubsetEnvelope>()(
  z.strictObject({ ...subsetHeader, definitions: z.array(z.unknown()).min(1) }),
);

// Version 1.1 envelopes (ADR-0192): the same fields plus exact font metadata.
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const resource = {
  id,
  sha256: hash,
  size: z.number().int().positive(),
  mime: z.literal('font/woff2'),
  profile: z.literal('inter-latin-400-ascii'),
};
const face = z.strictObject({
  id,
  family: text.max(256),
  weight: z.literal(400),
  style: z.literal('normal'),
  resource: id,
});
const binding = z.strictObject({ definitionId: qualifiedNameSchema, faceIds: z.array(id).min(1) });
const fontCredit = z.strictObject({
  id,
  license: text,
  attribution: text,
  notice: text,
  source,
  resourceIds: z.array(id).min(1),
  definitionIds: z.array(qualifiedNameSchema).min(1),
});
const fonts = <R extends z.ZodType>(resources: R) => ({
  fontResources: z.array(resources),
  fontFaces: z.array(face),
  definitionFonts: z.array(binding),
  fontCredits: z.array(fontCredit),
});

/** Structural 1.1 index; closure, membership and rights require the versioned parser. @internal */
export const index11Schema: z.ZodType<ShapePackIndex11> = checkedSchema<ShapePackIndex11>()(
  z.strictObject({
    format: z.literal('fluxion-shape-pack'),
    formatVersion: z.literal('1.1'),
    id: slug,
    version,
    name: text,
    license: text,
    attribution: text,
    categories,
    definitions: z.array(definitionEntry).min(1),
    credits: z.array(credit).min(1),
    ...fonts(z.strictObject({ ...resource, path: text })),
  }),
);

/** Structural 1.1 category header; definitions receive the existing parser's diagnostics. @internal */
export const category11Schema: z.ZodType<{ formatVersion: '1.1'; definitions: unknown[] }> = z.strictObject({
  formatVersion: z.literal('1.1'),
  definitions: z.array(z.unknown()).min(1),
});

type Subset11Envelope = Omit<ShapePackSubset11, 'definitions'> & { definitions: unknown[] };
/** Structural 1.1 saved-subset header; geometry and closure require the versioned parser. @internal */
export const subset11Schema: z.ZodType<Subset11Envelope> = checkedSchema<Subset11Envelope>()(
  z.strictObject({
    format: z.literal('fluxion-shape-pack'),
    formatVersion: z.literal('1.1'),
    id: slug,
    version,
    license: text,
    attribution: text,
    credits: z.array(credit).min(1),
    definitions: z.array(z.unknown()).min(1),
    ...fonts(z.strictObject(resource)),
  }),
);
