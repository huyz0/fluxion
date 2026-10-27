// Pack connector definitions (FR-CON-010, ADR-0048 amendment M18.38): a declarative connector type a pack
// contributes. It names a built-in router whose output it decorates, one decoration from a closed set, its
// default style and its catalog text. No executable JSON: the decorations' path generators are routing's
// (`decorateRoute`), chosen by kind; a connector uses the type by naming its id as `route.type`.
import {
  checkedSchema,
  type Diagnostic,
  err,
  jsonPointer,
  ok,
  type QualifiedName,
  qualifiedNameSchema,
  type Result,
  type Style,
  styleSchema,
} from '@fluxion/schema';
import { z } from 'zod';

/**
 * A decoration of a route, by kind; lengths are in stroke widths so a thicker line keeps its look.
 *
 * @public
 */
export type ConnectorDecoration =
  | {
      /** A sine wave along the route. */
      readonly kind: 'wavy';
      /** Peak offset from the route. */
      readonly amplitude: number;
      /** Length of one wave. */
      readonly wavelength: number;
    }
  | {
      /** Straight strokes alternating either side of the route. */
      readonly kind: 'zigzag';
      /** Peak offset from the route. */
      readonly amplitude: number;
      /** Length of one zig and zag. */
      readonly wavelength: number;
    }
  | {
      /** Two parallel lines. */
      readonly kind: 'double';
      /** Distance between their centres. */
      readonly gap: number;
    }
  | {
      /** A hollow tube: a wide stroke with a lighter core. */
      readonly kind: 'pipe';
      /** Width of each wall. */
      readonly wall: number;
    }
  | {
      /** A thick line bound by ties across it at a fixed pitch. */
      readonly kind: 'cable';
      /** Distance between ties. */
      readonly pitch: number;
    };

/**
 * A connector type contributed by a pack (FR-CON-010).
 *
 * @public
 */
export type ConnectorDef = {
  /** `<namespace>:<name>`; a connector uses it as its `route.type`. */
  readonly id: QualifiedName;
  /** The built-in router whose output is decorated. */
  readonly router: 'straight' | 'curved' | 'orthogonal' | 'polyline';
  /** How the route is drawn. */
  readonly decoration: ConnectorDecoration;
  /** Style of a new connector of this type. */
  readonly defaultStyle?: Style;
  /** One line saying what the connector is for, for the AI catalog (FR-AI-002). */
  readonly describe?: string;
  /** Picker label. */
  readonly name?: string;
  /** Search words. */
  readonly keywords?: readonly string[];
};

/** Most of any decoration length, in stroke widths: past it a wave is a straight line drawn at great cost. */
const MAX_LENGTH = 1000;
const length = z.number().positive().max(MAX_LENGTH);
const decorationSchema: z.ZodType<ConnectorDecoration> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('wavy'), amplitude: length, wavelength: length }),
  z.strictObject({ kind: z.literal('zigzag'), amplitude: length, wavelength: length }),
  z.strictObject({ kind: z.literal('double'), gap: length }),
  z.strictObject({ kind: z.literal('pipe'), wall: length }),
  z.strictObject({ kind: z.literal('cable'), pitch: length }),
]);

/**
 * Schema of a connector definition.
 *
 * @public
 */
export const connectorDefSchema: z.ZodType<ConnectorDef> = checkedSchema<ConnectorDef>()(
  z.strictObject({
    id: qualifiedNameSchema,
    router: z.enum(['straight', 'curved', 'orthogonal', 'polyline']),
    decoration: decorationSchema,
    defaultStyle: styleSchema.optional(),
    describe: z.string().regex(/\S/).optional(),
    name: z.string().regex(/\S/).optional(),
    keywords: z.array(z.string().regex(/\S/)).optional(),
  }),
);

/**
 * The connector definitions of a pack's `connectors.json`: format `fluxion-connector-defs`, version `1.0`, nonempty
 * `definitions`, every id in namespace `pack` and listed once; each problem is an `FLX_PACK_INVALID` diagnostic at
 * its JSON pointer.
 *
 * @public
 */
export function parseConnectorDefs(input: unknown, pack: string): Result<readonly ConnectorDef[], readonly Diagnostic[]> {
  const envelope = z
    .strictObject({ format: z.literal('fluxion-connector-defs'), formatVersion: z.literal('1.0'), definitions: z.array(connectorDefSchema).min(1) })
    .safeParse(input);
  if (!envelope.success)
    return err(
      envelope.error.issues.map((issue) => ({
        code: 'FLX_PACK_INVALID',
        severity: 'error',
        path: jsonPointer(issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))),
        message: issue.message,
      })),
    );
  const problems: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const [i, def] of envelope.data.definitions.entries()) {
    const at = jsonPointer(['definitions', i, 'id']);
    if (!def.id.startsWith(`${pack}:`))
      problems.push({ code: 'FLX_PACK_INVALID', severity: 'error', path: at, message: `"${def.id}" is outside namespace "${pack}"` });
    else if (seen.has(def.id)) problems.push({ code: 'FLX_PACK_INVALID', severity: 'error', path: at, message: `"${def.id}" is listed twice` });
    seen.add(def.id);
  }
  return problems.length > 0 ? err(problems) : ok(envelope.data.definitions);
}
