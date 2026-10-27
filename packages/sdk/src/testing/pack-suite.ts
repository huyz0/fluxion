// The shared first-party pack suite (FR-LIB-007, NFR-LIC-003, ADR-0194): what a pack's checked-in files must be, and every
// problem with them. A pack's test only reads its files and asserts each problem list is empty; nothing here writes.
import type { ShapeDef } from '@fluxion/core';
import { buildShapePackFiles, type DeclarativeShapePack } from '../pack-source.js';
import { drawnPoints } from './drawn-points.js';
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
};

/**
 * What a pack package's generated files must hold: `pack/` (the canonical build), `__golden__/` (one
 * normalized SVG per definition, named by its local id) and `pack-versions.json`, the ledger of each
 * released version's category hashes. The ledger keeps every recorded version; the current version is
 * added when absent and never replaced, so changed geometry at a recorded version shows up as a problem.
 *
 * @public
 */
export type ShapePackExpectation = {
  /** Expected `pack/` files. */
  readonly pack: Readonly<Record<string, string>>;
  /** Expected `__golden__/` files. */
  readonly goldens: Readonly<Record<string, string>>;
  /** Expected ledger text. */
  readonly versions: string;
};

/**
 * Every problem of a checked-in pack, by check; a passing pack has every list empty.
 *
 * @public
 */
export type ShapePackProblems = {
  /** Missing, extra or changed files in `pack/`, `__golden__/` or the ledger. */
  readonly files: readonly string[];
  /** Loader diagnostics for the checked-in `pack/`, or a mismatch with the exported definitions. */
  readonly loading: readonly string[];
  /** Vendor or product names, which a generic first-party pack never carries (ADR-0050). */
  readonly brands: readonly string[];
  /** Definitions whose outline or decorations leave their box at the default size, or cannot be read. */
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
const localName = (def: ShapeDef): string => def.id.slice(def.id.indexOf(':') + 1);
const categoryHashes = (indexText: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries((JSON.parse(indexText) as { categories: Record<string, { sha256: string }> }).categories).map(([slug, c]) => [slug, c.sha256]),
  );
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
 * The files `pack` must have, given its existing ledger text (`versions`). A malformed ledger throws rather
 * than being rebuilt, so a write run can never drop recorded versions; repair it by hand.
 *
 * @public
 */
export function shapePackExpectation(pack: DeclarativeShapePack, versions: string | undefined): ShapePackExpectation {
  const files = buildShapePackFiles(pack);
  const ledger = parseLedger(versions);
  if (ledger === undefined) throw new Error('pack-versions.json is not a version ledger: repair it by hand, keeping every recorded version');
  const next = Object.hasOwn(ledger, pack.version) ? ledger : { ...ledger, [pack.version]: categoryHashes(files['index.json'] ?? '{}') };
  return {
    pack: files,
    goldens: Object.fromEntries(pack.definitions.map(({ def }) => [`${localName(def)}.svg`, renderShapeGolden(def)])),
    versions: `${JSON.stringify(next, null, 2)}\n`,
  };
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
    return outside.length ? [`${def.id}: draws outside its ${w}x${h} box at ${outside.map(([x, y]) => `(${x}, ${y})`).join(' ')}`] : [];
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
  const recorded = parseLedger(checkedIn.versions)?.[pack.version];
  const current = categoryHashes(files.pack['index.json'] ?? '{}');
  if (recorded !== undefined && JSON.stringify(recorded) !== JSON.stringify(current))
    out.push(`category hashes changed at the recorded version ${pack.version}: release the change as a new pack version`);
  return out;
}

/**
 * Every problem of `checkedIn` against the exported `pack`: files, host loading, brands, bounds and
 * versions (see {@link ShapePackProblems}).
 *
 * @public
 */
export async function checkShapePack(pack: DeclarativeShapePack, checkedIn: CheckedInShapePack): Promise<ShapePackProblems> {
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
    ...fileProblems('__golden__/', expected.goldens, checkedIn.goldens),
    ...(checkedIn.versions === expected.versions ? [] : ['pack-versions.json differs from its build']),
  ];
  const loaded = await checkShapePackFiles(checkedIn.pack);
  const exported = pack.definitions.map(({ def }) => def);
  const loading = !loaded.ok
    ? loaded.error.map((d) => `${d.path} ${d.message}`)
    : sorted(loaded.value.definitions) === sorted(exported)
      ? []
      : ['pack/ does not load the exported definitions'];
  return {
    files,
    loading: [...(pack.definitions.length === 0 ? ['the pack exports no definitions'] : []), ...loading],
    brands: Object.entries(expected.pack).flatMap(([path, text]) => (BRANDS.test(text) ? [`pack/${path} names a vendor brand`] : [])),
    bounds: boundsProblems(pack),
    versions: versionProblems(pack, expected, checkedIn),
  };
}
