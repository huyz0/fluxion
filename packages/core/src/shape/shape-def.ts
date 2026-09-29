// Shape definitions (ADR-0016, 03-core-engine §5, FR-SHP-003): pure JSON supplied by packs and
// registered in core's `shapeDefs` registry. The type is written once with TSDoc and proven equal to
// its Zod schema (ADR-0140); parseShapeDef turns schema issues into diagnostics.
import {
  type AnchorDef,
  anchorDefSchema,
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
import { definitionIssues } from './check.js';

/**
 * A number or integer parameter; element values are clamped into `min … max`.
 *
 * @public
 */
export type NumberParam = {
  /** `int` values are rounded before clamping. */
  readonly type: 'number' | 'int';
  /** Smallest value. */
  readonly min?: number;
  /** Largest value. */
  readonly max?: number;
  /** Value when the element sets none (or an invalid one). */
  readonly default: number;
};

/**
 * A choice among named values; expressions read the index of the value in `values`.
 *
 * @public
 */
export type EnumParam = {
  /** Discriminator. */
  readonly type: 'enum';
  /** The allowed values, in order. */
  readonly values: readonly string[];
  /** Value when the element sets none (or an invalid one). */
  readonly default: string;
};

/**
 * A list of vertices as `[x, y]` fractions of the box, for a `points` outline.
 *
 * @public
 */
export type PointsParam = {
  /** Discriminator. */
  readonly type: 'points';
  /** Fewest vertices (at least 2). */
  readonly min?: number;
  /** Most vertices (at most 10 000). */
  readonly max?: number;
  /** Vertices when the element sets none (or an invalid list). */
  readonly default: readonly (readonly [number, number])[];
};

/**
 * A parameter of a shape definition.
 *
 * @public
 */
export type ParamSpec = NumberParam | EnumParam | PointsParam;

/**
 * How a shape's outline is written (ADR-0016 item 1): exactly one of a path template, a polygon
 * generator or the vertices of a `points` param.
 *
 * @public
 */
export type OutlineSpec =
  | {
      /** One subpath of absolute SVG path data (`M L H V C Q A Z`) whose numbers may be `{expr}`. */
      readonly path: string;
    }
  | {
      /** A closed polygon of `n` vertices at `(x, y)`, evaluated for `i = 0 … n-1`. */
      readonly polygon: {
        /** Vertex count, an integer from 2 to 1 024. */
        readonly n: string;
        /** Horizontal position of vertex `i`. */
        readonly x: string;
        /** Vertical position of vertex `i`. */
        readonly y: string;
      };
    }
  | {
      /** Name of the `points` param holding the vertices. */
      readonly points: string;
      /** Join the last vertex back to the first (default false). */
      readonly closed?: boolean;
      /** Draw a Catmull-Rom curve through the vertices instead of straight lines. */
      readonly smooth?: boolean;
    };

/**
 * A region holding the element's text, as fractions of the box.
 *
 * @public
 */
export type TextRegionDef = {
  /** Region name, unique on the definition. */
  readonly name: string;
  /** Left edge, 0 … 1. */
  readonly x: number;
  /** Top edge, 0 … 1. */
  readonly y: number;
  /** Width, 0 … 1. */
  readonly w: number;
  /** Height, 0 … 1. */
  readonly h: number;
};

/**
 * A drag handle bound to a number or integer param, placed by two expressions in the box.
 *
 * @public
 */
export type HandleDef = {
  /** The param the handle edits. */
  readonly param: string;
  /** Horizontal position. */
  readonly x: string;
  /** Vertical position. */
  readonly y: string;
};

/**
 * A parametric shape definition (03-core-engine §5, ADR-0016).
 *
 * @public
 */
export type ShapeDef = {
  /** `<namespace>:<name>`, e.g. `basic:star`. */
  readonly id: QualifiedName;
  /** Parameters by name; number, int and enum params are identifiers of the expressions. */
  readonly params?: { readonly [name: string]: ParamSpec };
  /** The outline. */
  readonly outline: OutlineSpec;
  /** Named anchors; default n, e, s, w and center. */
  readonly anchors?: readonly AnchorDef[];
  /** Text regions; default an inset box. */
  readonly textRegions?: readonly TextRegionDef[];
  /** Drag handles. */
  readonly handles?: readonly HandleDef[];
  /** Size of a new element. */
  readonly defaultSize: {
    /** Width in logical pixels. */
    readonly w: number;
    /** Height in logical pixels. */
    readonly h: number;
  };
  /** Style of a new element. */
  readonly defaultStyle?: Style;
  /** Stroke-only path templates drawn over the outline (a cylinder's top, a document's fold). */
  readonly decorations?: readonly {
    /** One subpath of absolute SVG path data whose numbers may be `{expr}`, stroked only. */
    readonly path: string;
  }[];
  /** Search words for the shape picker. */
  readonly keywords?: readonly string[];
  /** Picker category. */
  readonly category?: string;
  /** SPDX licence of the definition. */
  readonly license?: string;
};

/** Identifiers every expression may read; params may not shadow them. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['w', 'h', 'i', 'n', 'pi']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Most vertices of a points outline (ADR-0016 item 6). */
export const MAX_POINTS = 10_000;

const expr = z.string().min(1).max(2000);
const unit = z.number().min(0).max(1);
const numberParam = z.strictObject({ type: z.enum(['number', 'int']), min: z.number().optional(), max: z.number().optional(), default: z.number() });
const enumParam = z.strictObject({ type: z.literal('enum'), values: z.array(z.string().min(1)).min(1), default: z.string() });
const pointsParam = z.strictObject({
  type: z.literal('points'),
  min: z.number().int().min(2).max(MAX_POINTS).optional(),
  max: z.number().int().min(2).max(MAX_POINTS).optional(),
  default: z
    .array(z.tuple([unit, unit]))
    .min(2)
    .max(MAX_POINTS),
});
const outlineSchema = z.union([
  z.strictObject({ path: expr.max(100_000) }),
  z.strictObject({ polygon: z.strictObject({ n: expr, x: expr, y: expr }) }),
  z.strictObject({ points: z.string().min(1), closed: z.boolean().optional(), smooth: z.boolean().optional() }),
]);

/** An enum's values are unique and hold its default. */
function enumIssue(p: z.infer<typeof enumParam>): string | null {
  if (new Set(p.values).size !== p.values.length) return 'enum values must be unique';
  return p.values.includes(p.default) ? null : `default "${p.default}" is not one of the values`;
}

/** Cross-field rules of one param: a default inside its range, a known enum default, a list inside its count. */
function paramIssue(p: z.infer<typeof numberParam> | z.infer<typeof enumParam> | z.infer<typeof pointsParam>): string | null {
  if (p.type === 'enum') return enumIssue(p);
  if (p.type === 'int' && ![p.min, p.max, p.default].every((v) => v === undefined || Number.isInteger(v)))
    return 'an int param has integer min, max and default';
  const [min, max] = [p.min ?? Number.NEGATIVE_INFINITY, p.max ?? Number.POSITIVE_INFINITY];
  if (min > max) return `min ${min} is greater than max ${max}`;
  const count = p.type === 'points' ? p.default.length : p.default;
  return count < min || count > max ? `default is outside ${p.min ?? '…'} … ${p.max ?? '…'}` : null;
}

// the raw object is checked first: Zod's record skips a __proto__ key (as JSON.parse makes it), which
// would leave a param that expressions cannot read (M5.7 review F1)
const paramsSchema = z
  .unknown()
  .refine((v) => !(typeof v === 'object' && v !== null && Object.hasOwn(v, '__proto__')), {
    message: 'param name "__proto__" is reserved',
    path: ['__proto__'],
  })
  .pipe(z.record(z.string(), z.union([numberParam, enumParam, pointsParam])));

const shapeDefObject = z.strictObject({
  id: qualifiedNameSchema,
  params: paramsSchema.optional(),
  outline: outlineSchema,
  anchors: z.array(anchorDefSchema).optional(),
  textRegions: z.array(z.strictObject({ name: z.string().min(1), x: unit, y: unit, w: unit, h: unit })).optional(),
  handles: z.array(z.strictObject({ param: z.string().min(1), x: expr, y: expr })).optional(),
  defaultSize: z.strictObject({ w: z.number().positive(), h: z.number().positive() }),
  defaultStyle: styleSchema.optional(),
  decorations: z
    .array(z.strictObject({ path: expr.max(100_000) }))
    .max(16)
    .optional(),
  keywords: z.array(z.string()).optional(),
  category: z.string().optional(),
  license: z.string().optional(),
});

type Issue = { readonly path: readonly (string | number)[]; readonly message: string; readonly code?: Diagnostic['code'] };

/** A param's name is an identifier that shadows no reserved name, and its spec is consistent. */
function paramIssues(name: string, p: z.infer<typeof numberParam> | z.infer<typeof enumParam> | z.infer<typeof pointsParam>): Issue[] {
  const issues: Issue[] = [];
  if (!NAME.test(name) || RESERVED_NAMES.has(name))
    issues.push({ path: ['params', name], message: `param name "${name}" must be an identifier other than w, h, i, n and pi` });
  const issue = paramIssue(p);
  if (issue !== null) issues.push({ path: ['params', name], message: issue });
  return issues;
}

/**
 * Rules spanning fields: param names and ranges, the params that outlines and handles name, and every
 * template and expression, which must parse and read only the names its place allows (M5 cp1 F2).
 */
function crossIssues(def: z.infer<typeof shapeDefObject>): Issue[] {
  const params = def.params ?? {};
  const issues: Issue[] = Object.entries(params).flatMap(([name, p]) => paramIssues(name, p));
  if ('points' in def.outline && params[def.outline.points]?.type !== 'points')
    issues.push({ path: ['outline', 'points'], message: `"${def.outline.points}" is not a points param` });
  for (const [i, h] of (def.handles ?? []).entries()) {
    const type = params[h.param]?.type;
    if (type !== 'number' && type !== 'int') issues.push({ path: ['handles', i, 'param'], message: `"${h.param}" is not a number or int param` });
  }
  return [...issues, ...definitionIssues(def)];
}

/**
 * Schema of a shape definition, with its cross-field rules.
 *
 * @public
 */
export const shapeDefSchema: z.ZodType<ShapeDef> = checkedSchema<ShapeDef>()(
  shapeDefObject.superRefine((def, ctx) => {
    for (const issue of crossIssues(def)) ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message, params: { code: issue.code } });
  }),
);

/**
 * Validate `input` as a shape definition; every problem is a diagnostic at its JSON pointer under `at`:
 * `FLX_SHAPE_DEF_INVALID` for the schema, and a template's or expression's own code (`FLX_SHAPE_PATH`,
 * `FLX_EXPR_SYNTAX`, `FLX_EXPR_UNKNOWN`, …) for what it holds.
 *
 * @public
 */
export function parseShapeDef(input: unknown, at: ReadonlyArray<string | number> = []): Result<ShapeDef, readonly Diagnostic[]> {
  const r = shapeDefSchema.safeParse(input);
  if (r.success) return ok(r.data);
  return err(
    r.error.issues.map((issue) => ({
      code: (issue.code === 'custom' ? (issue.params?.['code'] as Diagnostic['code'] | undefined) : undefined) ?? 'FLX_SHAPE_DEF_INVALID',
      severity: 'error',
      path: jsonPointer([...at, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))]),
      message: issue.message,
    })),
  );
}
