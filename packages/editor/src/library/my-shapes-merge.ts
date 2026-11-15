// The pack a My shapes item carries and merging two subsets of one pack version (M18.122 r1 F2, M19.34 r1 F1), split from
// my-shapes-packs.ts for its size; that module re-exports what is public.
import { allowsShapePackContentLicense, parseVersionedShapePackSubset, type ShapePackSubset11, type VersionedShapePackSubset } from '@fluxion/core';

/**
 * What reading something untrusted gave: `value`, or why it was refused.
 *
 * @public
 */
export type MyShapesResult<T> =
  | {
      /** It was read. */
      readonly ok: true;
      /** What was read. */
      readonly value: T;
    }
  | {
      /** It was refused. */
      readonly ok: false;
      /** Why, for the person. */
      readonly reason: string;
    };

/**
 * One pack subset a My shapes item carries.
 *
 * @public
 */
export type MyShapePack = {
  /** The canonical saved subset, narrowed to the shapes the item uses, with its credits. */
  readonly subset: VersionedShapePackSubset;
  /** The exact artwork font bytes the subset's 1.1 resources retain, base64 by lowercase SHA-256 (none for 1.0). */
  readonly fonts: Readonly<Record<string, string>>;
};

/** `value` as JSON with every object's keys sorted, so two equal definitions compare equal however they were built. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );

/** The first message of `diagnostics`, for the person. */
const firstMessage = (diagnostics: readonly { readonly message: string }[]): string => diagnostics[0]?.message ?? 'the packs could not be read';

/** `a` then the entries of `b` keyed by `key` it lacks; undefined when an entry under the same key differs. */
function unionBy<T>(
  a: readonly T[],
  b: readonly T[],
  key: (t: T) => string,
  join: (x: T, y: T) => T | undefined = (x, y) => (canonical(x) === canonical(y) ? x : undefined),
): T[] | undefined {
  const out = new Map(a.map((t) => [key(t), t]));
  for (const t of b) {
    const held = out.get(key(t));
    const joined = held === undefined ? t : join(held, t);
    if (joined === undefined) return undefined;
    out.set(key(t), joined);
  }
  return [...out.values()];
}

/** Two scoped credits of one source credit: the same credit covering both scopes (absent covers every definition). */
function joinScoped<T extends { readonly definitionIds?: readonly string[] }>(x: T, y: T): T | undefined {
  const { definitionIds: dx, ...restX } = x;
  const { definitionIds: dy, ...restY } = y;
  if (canonical(restX) !== canonical(restY) || (dx === undefined) !== (dy === undefined)) return undefined;
  return dx === undefined || dy === undefined ? x : { ...x, definitionIds: [...new Set([...dx, ...dy])].sort() };
}

/** The 1.1 font fields of `x` and `y` joined, or undefined when an entry under the same key differs. */
function mergedFonts(x: ShapePackSubset11, y: ShapePackSubset11): Record<string, unknown> | undefined {
  const byDefinition = (p: { readonly definitionId: string }, q: { readonly definitionId: string }) => (p.definitionId < q.definitionId ? -1 : 1);
  const fields: Record<string, unknown> = {
    fontResources: unionBy(x.fontResources, y.fontResources, (r) => r.id),
    fontFaces: unionBy(x.fontFaces, y.fontFaces, (f) => f.id),
    definitionFonts: unionBy(x.definitionFonts, y.definitionFonts, (d) => d.definitionId)?.sort(byDefinition),
    fontCredits: unionBy(x.fontCredits, y.fontCredits, (c) => c.id, joinScoped),
  };
  if (x.categoryNames !== undefined || y.categoryNames !== undefined) {
    const names = unionBy(Object.entries(x.categoryNames ?? {}), Object.entries(y.categoryNames ?? {}), ([slug]) => slug);
    fields['categoryNames'] = names && Object.fromEntries(names);
  }
  return Object.values(fields).includes(undefined) ? undefined : fields;
}

const ENVELOPE = ['format', 'id', 'version', 'license', 'attribution'] as const;

/**
 * The format two subsets of one pack version merge in: their own when equal, 1.3 for a 1.2 and a 1.3 (a save writes a 1.3 pack's
 * subset as 1.2 when it uses no icon slot, ADR-0054, and 1.3 is 1.2 plus slots), else none.
 */
function mergedFormat(x: VersionedShapePackSubset, y: VersionedShapePackSubset): VersionedShapePackSubset['formatVersion'] | undefined {
  if (x.formatVersion === y.formatVersion) return x.formatVersion;
  const pair = new Set([x.formatVersion, y.formatVersion]);
  return pair.has('1.2') && pair.has('1.3') ? '1.3' : undefined;
}

/**
 * One pack holding the shapes of both `a` and `b`, two subsets of the same pack version (as two items saved from one pack
 * carry): `a` itself when `b` adds no shape; why not, when they are other versions or a shape, credit or font differs.
 *
 * @public
 */
export function mergeMyShapePacks(a: MyShapePack, b: MyShapePack): MyShapesResult<MyShapePack> {
  const x = a.subset;
  const y = b.subset;
  const formatVersion = mergedFormat(x, y);
  if (formatVersion === undefined || ENVELOPE.some((field) => x[field] !== y[field]))
    return { ok: false, reason: `the document has another version of ${x.id}` };
  const differs = { ok: false as const, reason: `the document has other shapes under ${x.id}` };
  const definitions = unionBy(x.definitions, y.definitions, (d) => d.id);
  if (definitions === undefined) return differs;
  if (definitions.length === x.definitions.length && formatVersion === x.formatVersion) return { ok: true, value: a };
  const credits = unionBy(x.credits, y.credits, (c) => c.id, joinScoped);
  // the formats merge, so both are 1.0 or both carry fonts; category names (1.2 and 1.3) are the pack's, so their union holds
  const fonts = x.formatVersion === '1.0' ? {} : mergedFonts(x, y as ShapePackSubset11);
  if (credits === undefined || fonts === undefined) return differs;
  const names = { ...(y as Partial<ShapePackSubset11>).categoryNames, ...(x as Partial<ShapePackSubset11>).categoryNames };
  const merged = {
    ...x,
    formatVersion,
    definitions: definitions.sort((p, q) => (p.id < q.id ? -1 : 1)),
    credits,
    ...fonts,
    ...(Object.keys(names).length ? { categoryNames: names } : {}),
  };
  const subset = parseVersionedShapePackSubset(merged, allowsShapePackContentLicense);
  if (!subset.ok) return { ok: false, reason: firstMessage(subset.error) };
  return { ok: true, value: { subset: subset.value, fonts: { ...a.fonts, ...b.fonts } } };
}
