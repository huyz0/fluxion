import { checkedSchema, qualifiedNameSchema } from '@fluxion/schema';
import { z } from 'zod';
import type { ShapePackCategory, ShapePackIndex } from './pack-types.js';
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
