// Marker definitions (FR-CON-003): the shape drawn at a connector end, as data. Render draws the
// built-ins and packs add their own (`<namespace>:<name>`); both register in a `markers` registry.
// A marker is sized in stroke widths and the route is trimmed under it by its inset (render, routing).
import { checkedSchema, type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { MAX_SEGMENTS, parseTemplate, TemplateFailure } from './shape/template.js';

/**
 * A connector end marker: a path in a 10 x 10 box whose tip is at (10, 5), pointing along +x. It is
 * sized in stroke widths, so it scales with the connector's stroke.
 *
 * @public
 */
export type MarkerDef = {
  /** Marker id: a schema built-in (`arrow`, `triangle`, …) or `<namespace>:<name>`. */
  readonly id: string;
  /** Absolute SVG path data in the 10 x 10 box; several subpaths draw several strokes. */
  readonly path: string;
  /** How far back from the tip the route stops, in box units (0: at the tip; 10: the box's back). */
  readonly inset: number;
  /** Filled with the stroke colour; otherwise stroked as wide as the connector (an open marker). */
  readonly filled: boolean;
};

/**
 * A marker's size in stroke widths: its 10 x 10 box is drawn this many stroke widths wide and tall.
 *
 * @public
 */
export const MARKER_SIZE = 5;

/**
 * How far to trim a route of stroke `width` px under the marker `def` (none: 0), px: its inset, in box
 * units of MARKER_SIZE / 10 stroke widths.
 *
 * @public
 */
export function markerTrim(def: MarkerDef | undefined, width: number): number {
  return def === undefined ? 0 : (def.inset * MARKER_SIZE * width) / 10;
}

/** The path's own problem, if its data does not parse (a marker's path is literal: no `{…}` expressions). */
function pathProblem(path: string): string | undefined {
  if (path.includes('{')) return 'a marker path is literal path data, without {…} expressions';
  // a marker may draw several strokes (a crow's foot and a bar): each subpath is checked on its own,
  // and all of them together stay within one template's segment cap (ADR-0016 item 6; M5.36 review F2)
  const subpaths = path.trim().split(/(?=M)/);
  let segments = 0;
  for (const [k, subpath] of subpaths.entries()) {
    try {
      // tzap disable next-line ArrayDeclaration,StringLiteral: only the failure's message is kept
      segments += parseTemplate(subpath, ['path']).length - 1;
    } catch (e) {
      // tzap disable next-line ConditionalExpression: the template parser throws nothing else
      if (!(e instanceof TemplateFailure)) throw e;
      // the parser's offsets count from the subpath's start
      return subpaths.length > 1 ? `subpath ${k + 1}: ${e.diagnostic.message}` : e.diagnostic.message;
    }
  }
  return segments > MAX_SEGMENTS ? `the marker has ${segments} segments; at most ${MAX_SEGMENTS}` : undefined;
}

/**
 * The schema of a marker definition: a non-empty id, literal path data, an inset from 0 to 10 box
 * units and whether it is filled.
 *
 * @public
 */
export const markerDefSchema: z.ZodType<MarkerDef> = checkedSchema<MarkerDef>()(
  z.object({ id: z.string().min(1), path: z.string().min(1), inset: z.number().min(0).max(10), filled: z.boolean() }).superRefine((def, ctx) => {
    // an empty path is already refused for its length
    const problem = def.path === '' ? undefined : pathProblem(def.path);
    if (problem !== undefined) ctx.addIssue({ code: 'custom', path: ['path'], message: problem });
  }),
);

/**
 * Validate `input` as a marker definition; every problem is an `FLX_PACK_INVALID` diagnostic at its
 * JSON pointer under `at`.
 *
 * @public
 */
export function parseMarkerDef(input: unknown, at: ReadonlyArray<string | number> = []): Result<MarkerDef, readonly Diagnostic[]> {
  const r = markerDefSchema.safeParse(input);
  if (r.success) return ok(r.data);
  return err(
    r.error.issues.map((issue) => ({
      code: 'FLX_PACK_INVALID',
      severity: 'error',
      path: jsonPointer([...at, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))]),
      message: issue.message,
    })),
  );
}
