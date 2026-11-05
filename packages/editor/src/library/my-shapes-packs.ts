// The pack subsets a My shapes item carries (FR-LIB-008, FR-LIB-009, NFR-LIC-003; M18.122, ADR-0048 amendment M18.122): an
// item that uses shapes of a saved or installed pack keeps the same canonical 1.0/1.1 subsets a save would embed, narrowed to
// the shapes it uses, with their credits and the exact artwork font bytes a 1.1 subset retains. Inserting it registers only the
// namespaces the document lacks, or gains the shapes a namespace an earlier insert brought lacks; a namespace the
// document holds with other geometry refuses the whole insert, leaving what was there.
import {
  type ArtworkShapeRegistries,
  allowsShapePackContentLicense,
  parseVersionedShapePackSubset,
  type ShapeDef,
  type ShapePackSubset11,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { type ContentHasher, prepareUsedShapePacks, type ShapePackSourceData } from '@fluxion/format';
import { type ArtworkFontPorts, registerSavedShapePacks } from '@fluxion/render';
import type { AnyRecord } from '@fluxion/schema';

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

/**
 * Where a host's packs come from when an item is saved: the sources a save of the open document would embed from.
 *
 * @public
 */
export type MyShapePackSources = {
  /** The open document's pack sources now (saved, installed and imported). */
  readonly sources: () => readonly ShapePackSourceData[];
  /** The shapes every session has, which need no pack. */
  readonly builtinIds: ReadonlySet<string>;
  /** The SHA-256 port the subsets are hashed with. */
  readonly hasher: ContentHasher;
};

/** The most packs one item carries. */
const MAX_PACKS = 32;
const SHA256 = /^[0-9a-f]{64}$/;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** The bytes of base64 `text`, or undefined when it is not base64. */
const fromBase64 = (text: string): Uint8Array | undefined => {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
};

/** The SHA-256 of every font resource `subset` retains (none for 1.0). */
const retainedFonts = (subset: VersionedShapePackSubset): readonly string[] =>
  subset.formatVersion === '1.1' ? subset.fontResources.map((r) => r.sha256) : [];

/** The first message of `diagnostics`, for the person. */
const firstMessage = (diagnostics: readonly { readonly message: string }[]): string => diagnostics[0]?.message ?? 'the packs could not be read';

/**
 * The packs `records` need beyond `host.builtinIds`, taken from `host.sources()` exactly as a save would embed them; why not,
 * when a shape has no source (it would not insert in another session) or a source is refused.
 *
 * @public
 */
export async function packsFor(records: readonly AnyRecord[], host: MyShapePackSources): Promise<MyShapesResult<readonly MyShapePack[]>> {
  const document = { records: Object.fromEntries(records.map((r) => [r.id, r])) };
  const prepared = await prepareUsedShapePacks(document, host.sources(), {
    builtinIds: host.builtinIds,
    licensePolicy: allowsShapePackContentLicense,
    hasher: host.hasher,
  });
  if (!prepared.ok) return { ok: false, reason: firstMessage(prepared.error) };
  const packs: MyShapePack[] = [];
  for (const lock of prepared.value.locks) {
    const bytes = prepared.value.extraEntries.get(lock.entry);
    const subset = parseVersionedShapePackSubset(JSON.parse(new TextDecoder().decode(bytes)), allowsShapePackContentLicense);
    if (!subset.ok) return { ok: false, reason: firstMessage(subset.error) };
    const fonts: Record<string, string> = {};
    for (const sha256 of retainedFonts(subset.value)) {
      const font = prepared.value.fontAssets.get(sha256);
      if (font === undefined) return { ok: false, reason: `the font ${sha256} of ${subset.value.id} is missing` };
      fonts[sha256] = toBase64(font);
    }
    packs.push({ subset: subset.value, fonts });
  }
  return { ok: true, value: packs };
}

/** `raw` as the font map of `subset`: exactly its retained hashes, each base64. */
function fontsOf(raw: unknown, subset: VersionedShapePackSubset): Readonly<Record<string, string>> | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'its fonts are not a map';
  const entries = Object.entries(raw);
  const wanted = new Set(retainedFonts(subset));
  if (entries.length !== wanted.size) return 'its fonts do not match the subset';
  for (const [sha256, text] of entries) {
    if (!SHA256.test(sha256) || !wanted.has(sha256) || typeof text !== 'string' || fromBase64(text) === undefined) return `its font ${sha256} is not valid`;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * The packs of an untrusted item: each a 1.0 or 1.1 subset under the content policy, each namespace once, with exactly
 * the fonts it retains; or why not.
 *
 * @public
 */
export function parseMyShapePacks(raw: unknown): readonly MyShapePack[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_PACKS) return 'its packs are not a list';
  const packs: MyShapePack[] = [];
  for (const [k, entry] of raw.entries()) {
    const { subset: rawSubset, fonts: rawFonts } = (typeof entry === 'object' && entry !== null ? entry : {}) as { subset?: unknown; fonts?: unknown };
    const subset = parseVersionedShapePackSubset(rawSubset, allowsShapePackContentLicense);
    if (!subset.ok) return `pack ${k}: ${firstMessage(subset.error)}`;
    if (packs.some((p) => p.subset.id === subset.value.id)) return `pack ${k} repeats namespace ${subset.value.id}`;
    const fonts = fontsOf(rawFonts, subset.value);
    if (typeof fonts === 'string') return `pack ${k}: ${fonts}`;
    packs.push({ subset: subset.value, fonts });
  }
  return packs;
}

/**
 * The shapes `packs` define.
 *
 * @public
 */
export const packShapeIds = (packs: readonly MyShapePack[] | undefined): ReadonlySet<string> =>
  new Set((packs ?? []).flatMap((p) => p.subset.definitions.map((d) => d.id)));

/** Whether `registries` holds namespace `id` (a definition under it, or registered from it). */
const holds = (registries: ArtworkShapeRegistries, id: string): boolean =>
  registries.shapeDefs.list().some(([defId]) => defId.startsWith(`${id}:`) || registries.shapeDefs.source(defId) === id);

/** `value` as JSON with every object's keys sorted, so two equal definitions compare equal however they were built. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );

/** Why `pack` cannot use the namespace `registries` holds already (a shape it lacks, or other geometry), or undefined. */
function heldRefusal(registries: ArtworkShapeRegistries, pack: MyShapePack): string | undefined {
  for (const def of pack.subset.definitions as readonly ShapeDef[]) {
    const held = registries.shapeDefs.get(def.id);
    if (held === undefined) return `the document's ${pack.subset.id} shapes do not include ${def.id}`;
    if (canonical(held) !== canonical(def)) return `the document has other shapes under ${pack.subset.id}`;
  }
  return undefined;
}

/**
 * The {@link MyShapesPacks.check} over `installed`, which reads the definition a shape id has here (the document's, else an installed
 * first-party pack's, never registering it): `packs` cannot be used when one of its shapes has other geometry here, as an item saved
 * from an older pack version whose geometry changed (M18.271, cp43 F5). A shape absent here is not a refusal: the insert registers it.
 *
 * @public
 */
export function myShapePacksCheck(installed: (id: string) => Promise<ShapeDef | undefined>): (packs: readonly MyShapePack[]) => Promise<string | undefined> {
  return async (packs) => {
    for (const pack of packs) {
      for (const def of pack.subset.definitions as readonly ShapeDef[]) {
        const here = await installed(def.id);
        if (here !== undefined && canonical(here) !== canonical(def)) return `the ${pack.subset.id} shapes here have other geometry for ${def.id}`;
      }
    }
    return undefined;
  };
}

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

const ENVELOPE = ['format', 'formatVersion', 'id', 'version', 'license', 'attribution'] as const;

/**
 * One pack holding the shapes of both `a` and `b`, two subsets of the same pack version (as two items saved from one pack
 * carry): `a` itself when `b` adds no shape; why not, when they are other versions or a shape, credit or font differs.
 *
 * @public
 */
export function mergeMyShapePacks(a: MyShapePack, b: MyShapePack): MyShapesResult<MyShapePack> {
  const x = a.subset;
  const y = b.subset;
  if (ENVELOPE.some((field) => x[field] !== y[field])) return { ok: false, reason: `the document has another version of ${x.id}` };
  const differs = { ok: false as const, reason: `the document has other shapes under ${x.id}` };
  const definitions = unionBy(x.definitions, y.definitions, (d) => d.id);
  if (definitions === undefined) return differs;
  if (definitions.length === x.definitions.length) return { ok: true, value: a };
  const credits = unionBy(x.credits, y.credits, (c) => c.id, joinScoped);
  // the envelope is equal, so both are 1.0 or both carry fonts
  const fonts = x.formatVersion === '1.0' ? {} : mergedFonts(x, y as ShapePackSubset11);
  if (credits === undefined || fonts === undefined) return differs;
  const merged = { ...x, definitions: definitions.sort((p, q) => (p.id < q.id ? -1 : 1)), credits, ...fonts };
  const subset = parseVersionedShapePackSubset(merged, allowsShapePackContentLicense);
  if (!subset.ok) return { ok: false, reason: firstMessage(subset.error) };
  return { ok: true, value: { subset: subset.value, fonts: { ...a.fonts, ...b.fonts } } };
}

/**
 * The packs inserted items made usable in one document: each namespace once, holding the shapes of every item that brought it.
 *
 * @public
 */
export type MyShapePackSet = {
  /**
   * Make `packs` usable, one call at a time in call order: a namespace the set holds gains the shapes it lacks, a namespace the
   * document holds otherwise is used as it is when it has every shape with the same geometry, and an absent one is registered
   * through `registerSavedShapePacks` with its exact fonts. Any refusal (other geometry, another version, a shape the document's
   * namespace lacks, a font that does not load) leaves what the set held before.
   */
  readonly add: (packs: readonly MyShapePack[]) => Promise<MyShapesResult<undefined>>;
  /** The packs the set holds, as sources for the save; a new array after each change. */
  readonly sources: () => readonly ShapePackSourceData[];
  /** Release everything the set registered (definitions and faces); a later `add` is refused. */
  readonly dispose: () => void;
};

/** Register `packs` through `registerSavedShapePacks` with their exact fonts: the release, or why not. */
async function registerPacks(registries: ArtworkShapeRegistries, packs: readonly MyShapePack[], ports: ArtworkFontPorts): Promise<MyShapesResult<() => void>> {
  const fonts = new Map<string, Uint8Array>();
  for (const pack of packs) for (const [sha256, text] of Object.entries(pack.fonts)) fonts.set(sha256, fromBase64(text) ?? new Uint8Array());
  const registered = await registerSavedShapePacks(
    registries,
    packs.map((p) => p.subset),
    { ...ports, bytesOf: (sha256) => fonts.get(sha256), policy: allowsShapePackContentLicense },
  );
  return registered.ok ? { ok: true, value: registered.value.dispose } : { ok: false, reason: firstMessage(registered.error) };
}

const sourceOf = (pack: MyShapePack): ShapePackSourceData => ({
  kind: 'embedded',
  subset: pack.subset,
  fonts: new Map(Object.entries(pack.fonts).map(([sha256, text]) => [sha256, fromBase64(text) ?? new Uint8Array()])),
});

/**
 * `held` with `pack` placed: merged into the pack of its namespace, used as the document holds it, or added when absent;
 * `held` itself when nothing changes, or why not.
 */
function placed(registries: ArtworkShapeRegistries, held: readonly MyShapePack[], pack: MyShapePack): MyShapesResult<readonly MyShapePack[]> {
  const i = held.findIndex((p) => p.subset.id === pack.subset.id);
  const mine = held[i];
  if (mine !== undefined) {
    const merged = mergeMyShapePacks(mine, pack);
    if (!merged.ok || merged.value === mine) return merged.ok ? { ok: true, value: held } : merged;
    return { ok: true, value: held.map((p, k) => (k === i ? merged.value : p)) };
  }
  if (!holds(registries, pack.subset.id)) return { ok: true, value: [...held, pack] };
  const reason = heldRefusal(registries, pack);
  return reason === undefined ? { ok: true, value: held } : { ok: false, reason };
}

/**
 * The set of My shapes packs of the document whose registries are `registries`.
 *
 * @public
 */
export function myShapePackSet(registries: ArtworkShapeRegistries, ports: ArtworkFontPorts): MyShapePackSet {
  let owned: readonly MyShapePack[] = [];
  let release: (() => void) | undefined;
  let sources: readonly ShapePackSourceData[] = [];
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const hold = (packs: readonly MyShapePack[], dispose: (() => void) | undefined) => {
    owned = packs;
    release = dispose;
    sources = packs.map(sourceOf);
  };
  /** What the set holds once `packs` are added (`owned` when nothing changes), or why they cannot be. */
  const plan = (packs: readonly MyShapePack[]): MyShapesResult<readonly MyShapePack[]> => {
    let next: MyShapesResult<readonly MyShapePack[]> = { ok: true, value: owned };
    for (const pack of packs) if (next.ok) next = placed(registries, next.value, pack);
    return next;
  };
  /** Register `next` in place of what the set holds; on a refusal, what it held is registered again. */
  const replace = async (next: readonly MyShapePack[]): Promise<MyShapesResult<undefined>> => {
    // a namespace cannot gain shapes in place (registration refuses a held namespace), so the set is registered again whole
    // the sources stay what they were until the new set is registered, so a save meanwhile still embeds the earlier shapes
    const previous = owned;
    release?.();
    release = undefined;
    const registered = await registerPacks(registries, next, ports);
    if (registered.ok) {
      hold(next, registered.value);
      return { ok: true, value: undefined };
    }
    const restored = previous.length === 0 ? undefined : await registerPacks(registries, previous, ports);
    hold(restored?.ok === true ? previous : [], restored?.ok === true ? restored.value : undefined);
    // told, not silent: the shapes inserted before are drawn as unknown until the document is opened again
    return {
      ok: false,
      reason: restored?.ok === false ? `${registered.reason}; the pack shapes inserted before could not be registered again` : registered.reason,
    };
  };
  const released = { ok: false as const, reason: 'the packs were released' };
  const step = async (packs: readonly MyShapePack[]): Promise<MyShapesResult<undefined>> => {
    if (disposed) return released;
    const next = plan(packs);
    if (!next.ok) return next;
    if (next.value === owned) return { ok: true, value: undefined };
    const result = await replace(next.value);
    if (!disposed) return result;
    release?.();
    hold([], undefined);
    return released;
  };
  return {
    add: (packs) => {
      const run = queue.then(() => step(packs));
      queue = run.catch(() => undefined);
      return run;
    },
    sources: () => sources,
    dispose: () => {
      disposed = true;
      release?.();
      hold([], undefined);
    },
  };
}
