// The shared first-party pack suite (FR-LIB-007, NFR-LIC-003, ADR-0194): what a pack's checked-in files must be, and every
// problem with them. A pack's test only reads its files and asserts each problem list is empty; nothing here writes.
import { type ArtworkFontBinding, allowsShapePackContentLicense, artworkFontAlias, encodeShapePack, type ShapeDef } from '@fluxion/core';
import type { Diagnostic } from '@fluxion/schema';
import { buildShapePackFiles, type DeclarativeShapePack } from '../pack-source.js';
import { drawnPoints } from './drawn-points.js';
import { geometryProblems } from './geometry-check.js';
import { checkShapePackFiles } from './pack-files.js';
import { renderShapeGolden } from './shape-golden.js';

/**
 * A pack package's checked-in files, as its test reads them: `pack/` and `__golden__/` by path below
 * each, its `package.json` text and its version ledger (`pack-versions.json`) text when present.
 *
 * @public
 */
export type CheckedInShapePack = {
  /** `pack/` files by pack-relative path. */
  readonly pack: Readonly<Record<string, string>>;
  /** `__golden__/` files by file name. */
  readonly goldens: Readonly<Record<string, string>>;
  /** The package's `package.json`. */
  readonly packageJson: string;
  /** `pack-versions.json`, absent before the first build. */
  readonly versions: string | undefined;
  /** `CHANGELOG.md`, absent before the first release: its `## <version>` headings are the released versions. */
  readonly changelog?: string | undefined;
  /** A 1.1 pack's binary `pack/fonts/` files by pack-relative path (`fonts/<sha256>.woff2`); absent for a 1.0 pack. */
  readonly fonts?: Readonly<Record<string, Uint8Array>>;
};

/**
 * What a pack package's generated files must hold: `pack/` (the canonical build), `__golden__/` (one
 * normalized SVG per definition, named by its local id) and `pack-versions.json`, the ledger of each
 * released version's category hashes (and a 1.1 pack's font hashes by path). The ledger keeps every recorded version; the current version is
 * added when absent and never replaced, so changed geometry at a recorded version shows up as a problem.
 * The pre-release rule: {@link UNRELEASED_PACK_VERSION} is never recorded, so geometry may change freely
 * until the first `changeset version` gives the pack a real version.
 *
 * @public
 */
export type ShapePackExpectation = {
  /** Expected `pack/` text files. */
  readonly pack: Readonly<Record<string, string>>;
  /** Expected binary `pack/` files of a 1.1 pack, its exact fonts by pack-relative path (ADR-0192); empty for 1.0. */
  readonly fonts: Readonly<Record<string, Uint8Array>>;
  /** Expected `__golden__/` files. */
  readonly goldens: Readonly<Record<string, string>>;
  /** Expected ledger text. */
  readonly versions: string;
};

/**
 * The version a pack has before its first release; the ledger never records it.
 *
 * @public
 */
export const UNRELEASED_PACK_VERSION = '0.0.0';

/** The versions a changesets `CHANGELOG.md` names as released: its `## <version>` headings. */
const releasedVersions = (changelog: string | undefined): string[] =>
  [...(changelog ?? '').matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/gm)].map((m) => m[1] as string);

/**
 * Every problem of a checked-in pack, by check; a passing pack has every list empty.
 *
 * @public
 */
export type ShapePackProblems = {
  /** Missing, extra or changed files in `pack/`, `__golden__/` or the ledger. */
  readonly files: readonly string[];
  /** Encoder diagnostics for the exported pack, loader diagnostics for the checked-in `pack/`, or a mismatch with the exported definitions. */
  readonly loading: readonly string[];
  /** Vendor or product names, which a generic first-party pack never carries (ADR-0050). */
  readonly brands: readonly string[];
  /**
   * Geometry leaving the box: the drawn golden at the default size, and the outline, decorations, handles
   * and text regions at each number param's minimum, maximum and default and every enum value; negative
   * text regions, anchors outside the box and number params without a range.
   */
  readonly bounds: readonly string[];
  /** Index, package and ledger versions that disagree, or geometry changed without a new version. */
  readonly versions: readonly string[];
};

/** Vendor and product names a generic first-party pack never carries (ADR-0050: no brand artwork or implied endorsement). */
const BRANDS = /\b(aws|amazon|azure|microsoft|gcp|google|alibaba|oracle|ibm|cisco|kubernetes|docker|apple|android|windows)\b/i;
/** How far a drawn point may fall outside the box, in units: rounding only. */
const SLACK = 0.5;

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
const sorted = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
const described = (d: Diagnostic): string => `${d.path} ${d.message}`;
const localName = (def: ShapeDef): string => def.id.slice(def.id.indexOf(':') + 1);
/** The ledger entry of a build: each category's hash by slug and, for 1.1, each exact font's hash by its path (ADR-0192). */
function categoryHashes(indexText: string): Record<string, string> {
  const index = JSON.parse(indexText) as { categories: Record<string, { sha256: string }>; fontResources?: { path: string; sha256: string }[] };
  const fonts = (index.fontResources ?? []).map((r) => [r.path, r.sha256]);
  return Object.fromEntries([...Object.entries(index.categories).map(([slug, c]) => [slug, c.sha256]), ...fonts]);
}
/** The ledger in `text`; absent text is an empty ledger, and anything but an object of hash objects is no ledger at all. */
function parseLedger(text: string | undefined): Record<string, Record<string, string>> | undefined {
  if (text === undefined) return {};
  try {
    const value: unknown = JSON.parse(text);
    const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (!isObject(value) || !Object.values(value).every((h) => isObject(h) && Object.values(h).every((x) => typeof x === 'string'))) return undefined;
    return value as Record<string, Record<string, string>>;
  } catch {
    return undefined;
  }
}

/**
 * The files `pack` must have, given its existing ledger text (`versions`). A pack the shared encoder refuses
 * and a malformed ledger throw rather than being rebuilt, so a write run can never drop recorded versions or
 * write a partial pack; repair the ledger by hand.
 *
 * @public
 */
export function shapePackExpectation(pack: DeclarativeShapePack, versions: string | undefined): ShapePackExpectation {
  const built = buildShapePackFiles(pack);
  if (!built.ok) throw new Error(`the pack does not encode: ${built.error.map(described).join('; ')}`);
  const files = built.value;
  const ledger = parseLedger(versions);
  if (ledger === undefined) throw new Error('pack-versions.json is not a version ledger: repair it by hand, keeping every recorded version');
  const { [UNRELEASED_PACK_VERSION]: _unreleased, ...recorded } = ledger;
  const next =
    pack.version === UNRELEASED_PACK_VERSION || Object.hasOwn(recorded, pack.version)
      ? recorded
      : { ...recorded, [pack.version]: categoryHashes(files['index.json'] ?? '{}') };
  return {
    pack: files,
    fonts: fontFiles(pack),
    goldens: Object.fromEntries(pack.definitions.map(({ def }) => [`${localName(def)}.svg`, renderShapeGolden(def, bindingsOf(pack, def.id))])),
    versions: `${JSON.stringify(next, null, 2)}\n`,
  };
}

/** The alias bindings of a 1.1 draft's definition, in its face order: what a host registers once the bytes are verified. */
function bindingsOf(pack: DeclarativeShapePack, id: string): ArtworkFontBinding[] {
  const fonts = pack.fonts;
  const faceIds = fonts?.definitionFonts.find((d) => d.definitionId === id)?.faceIds ?? [];
  return faceIds.flatMap((faceId) => {
    const face = fonts?.fontFaces.find((f) => f.id === faceId);
    const resource = fonts?.fontResources.find((r) => r.id === face?.resource);
    if (!face || !resource) return [];
    return [{ family: face.family, weight: face.weight, style: face.style, sha256: resource.sha256, alias: artworkFontAlias(resource.sha256) }];
  });
}

/** The exact font files of a 1.1 draft by resource path; the encoder has verified each against its resource. */
const fontFiles = (pack: DeclarativeShapePack): Record<string, Uint8Array> =>
  Object.fromEntries((pack.fonts?.fontResources ?? []).map((r) => [r.path, pack.fonts?.bytes.get(r.sha256) ?? new Uint8Array()]));

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

function fontProblems(expected: Readonly<Record<string, Uint8Array>>, actual: Readonly<Record<string, Uint8Array>>): string[] {
  const out: string[] = [];
  for (const [path, bytes] of Object.entries(expected)) {
    const found = Object.hasOwn(actual, path) ? actual[path] : undefined;
    if (found === undefined) out.push(`pack/${path} is missing`);
    else if (!sameBytes(found, bytes)) out.push(`pack/${path} differs from its build`);
  }
  for (const path of Object.keys(actual)) if (!Object.hasOwn(expected, path)) out.push(`pack/${path} belongs to no font resource`);
  return out;
}

function fileProblems(dir: string, expected: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const path of Object.keys(expected)) {
    if (!Object.hasOwn(actual, path)) out.push(`${dir}${path} is missing`);
    else if (actual[path] !== expected[path]) out.push(`${dir}${path} differs from its build`);
  }
  for (const path of Object.keys(actual)) if (!Object.hasOwn(expected, path)) out.push(`${dir}${path} belongs to no definition`);
  return out;
}

function boundsProblems(pack: DeclarativeShapePack): string[] {
  return pack.definitions.flatMap(({ def }) => {
    const { w, h } = def.defaultSize;
    const drawn = drawnPoints(renderShapeGolden(def));
    if (drawn.unreadable.length) return [`${def.id}: unreadable path data ${drawn.unreadable.join(', ')}`];
    const outside = drawn.points.filter(([x, y]) => x < -SLACK || y < -SLACK || x > w + SLACK || y > h + SLACK);
    const golden = outside.length ? [`${def.id}: draws outside its ${w}x${h} box at ${outside.map(([x, y]) => `(${x}, ${y})`).join(' ')}`] : [];
    return [...golden, ...geometryProblems(def)];
  });
}

function versionProblems(pack: DeclarativeShapePack, files: ShapePackExpectation, checkedIn: CheckedInShapePack): string[] {
  const out: string[] = [];
  let packageVersion: unknown;
  try {
    packageVersion = (JSON.parse(checkedIn.packageJson) as { version?: unknown }).version;
  } catch {
    packageVersion = undefined;
  }
  if (packageVersion !== pack.version) out.push(`pack version ${pack.version} differs from package version ${String(packageVersion)}`);
  const ledger = parseLedger(checkedIn.versions) ?? {};
  const recorded = pack.version === UNRELEASED_PACK_VERSION ? undefined : ledger[pack.version];
  const current = categoryHashes(files.pack['index.json'] ?? '{}');
  if (recorded !== undefined && JSON.stringify(recorded) !== JSON.stringify(current))
    out.push(`category hashes changed at the recorded version ${pack.version}: release the change as a new pack version`);
  for (const released of releasedVersions(checkedIn.changelog))
    if (!Object.hasOwn(ledger, released)) out.push(`pack-versions.json has no entry for the released version ${released}: restore it`);
  return out;
}

/**
 * Every problem of `checkedIn` against the exported `pack`: files, host loading, brands, bounds and
 * versions (see {@link ShapePackProblems}). A pack the shared encoder refuses (empty, outside its namespace,
 * invalid, unpermitted rights) reports only those diagnostics, under `loading`.
 *
 * @public
 */
export async function checkShapePack(pack: DeclarativeShapePack, checkedIn: CheckedInShapePack): Promise<ShapePackProblems> {
  // nothing else is meaningful until the pack encodes: its files, goldens and versions all derive from the build
  const built = buildShapePackFiles(pack);
  if (!built.ok) return { files: [], loading: built.error.map(described), brands: [], bounds: [], versions: [] };
  if (parseLedger(checkedIn.versions) === undefined) {
    const repaired = await checkShapePack(pack, { ...checkedIn, versions: undefined });
    return {
      ...repaired,
      files: repaired.files.filter((f) => !f.startsWith('pack-versions.json')),
      versions: ['pack-versions.json is not a version ledger: repair it by hand, keeping every recorded version'],
    };
  }
  const expected = shapePackExpectation(pack, checkedIn.versions);
  const files = [
    ...fileProblems('pack/', expected.pack, checkedIn.pack),
    ...fontProblems(expected.fonts, checkedIn.fonts ?? {}),
    ...fileProblems('__golden__/', expected.goldens, checkedIn.goldens),
    ...(checkedIn.versions === expected.versions ? [] : ['pack-versions.json differs from its build']),
  ];
  const loaded = await checkShapePackFiles(checkedIn.pack, allowsShapePackContentLicense, checkedIn.fonts);
  // as the encoder stores them: each category text becomes its slug (ADR-0196)
  const encoded = encodeShapePack(pack, allowsShapePackContentLicense);
  const exported = encoded.ok ? encoded.value.definitions : [];
  const loading = !loaded.ok
    ? loaded.error.map(described)
    : sorted(loaded.value.definitions) === sorted(exported)
      ? []
      : ['pack/ does not load the exported definitions'];
  return {
    files,
    loading,
    brands: Object.entries(expected.pack).flatMap(([path, text]) => (BRANDS.test(text) ? [`pack/${path} names a vendor brand`] : [])),
    bounds: boundsProblems(pack),
    versions: versionProblems(pack, expected, checkedIn),
  };
}
