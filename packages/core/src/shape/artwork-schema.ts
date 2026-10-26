import { checkedSchema, colorSchema, isSvgArtworkData, type SvgArtwork, type SvgArtworkNode, tokenRefSchema } from '@fluxion/schema';
// Bounded data, not markup. Semantic SVG geometry/references are checked by core (ADR-0180).
import { z } from 'zod';
import { parseSvgArtwork } from './artwork.js';

const nodeSchema: z.ZodType<SvgArtworkNode> = z.lazy(() =>
  checkedSchema<SvgArtworkNode>()(
    z.strictObject({ name: z.string(), attributes: z.record(z.string(), z.string()), children: z.array(z.union([z.string(), nodeSchema])) }),
  ),
);
const artworkObject = checkedSchema<SvgArtwork>()(
  z.strictObject({
    viewBox: z.strictObject({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
    root: nodeSchema,
    colors: z.record(colorSchema, tokenRefSchema).optional(),
  }),
);

/** Bounded artwork data schema. Core additionally validates geometry and local references. @public */
const svgArtworkSchema: z.ZodType<SvgArtwork> = z
  .unknown()
  .refine((input): boolean => isSvgArtworkData(input), { message: 'artwork must be bounded plain JSON without cycles or aliases' })
  .pipe(artworkObject);

/** The declarative parser shares the lightweight player's semantic validation. */
export const checkedArtworkSchema: z.ZodType<SvgArtwork> = svgArtworkSchema.superRefine((artwork, ctx) => {
  const result = parseSvgArtwork(artwork);
  if (!result.ok) for (const problem of result.error) ctx.addIssue({ code: 'custom', message: problem.message });
});
