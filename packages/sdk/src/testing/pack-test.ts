// The one first-party pack test (FR-LIB-007, ADR-0194, ADR-0199): a pack's `pack.test.ts` passes its exported source and the
// raw `import.meta.glob` results of its checked-in files, and this registers the comparison. Ordinary runs only compare; a
// write run needs `VITE_FLUXION_WRITE_PACK=1` and `vitest run -u` together, so the variable alone (say, leaked into a gate)
// fails instead of writing.
import { expect, it } from 'vitest';
import type { DeclarativeShapePack } from '../pack-source.js';
import { type CheckedInShapePack, checkShapePack, shapePackExpectation } from './pack-suite.js';

/**
 * A pack's checked-in files as `import.meta.glob(…, { query: '?raw', import: 'default', eager: true })` returns them, keyed by
 * the path relative to the test file in `src/`: `../pack/**\/*.json`, `../__golden__/**\/*`, `../package.json`,
 * `../pack-versions.json` and `../CHANGELOG.md`.
 *
 * @public
 */
export type ShapePackGlobs = {
  readonly pack: Readonly<Record<string, string>>;
  readonly goldens: Readonly<Record<string, string>>;
  readonly packageJson: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly changelog: Readonly<Record<string, string>>;
};

/** The variable that, with `vitest run -u`, makes a pack test rewrite its files. */
const WRITE_VARIABLE = 'VITE_FLUXION_WRITE_PACK';

type Env = Readonly<Record<string, string | undefined>>;

/** Whether `env` asks to rewrite the files. */
export function writeRequested(env: Env | undefined): boolean {
  return env?.[WRITE_VARIABLE] === '1';
}

/** This run's environment: the process's (live, so `vi.stubEnv` reaches it), else, in a browser, Vite's. */
export function runEnv(): Env | undefined {
  return (globalThis as { readonly process?: { readonly env: Env } }).process?.env ?? (import.meta as { readonly env?: Env }).env;
}

/** The files of `raw` by their path below `dir`. */
const below = (raw: Readonly<Record<string, string>>, dir: string): Record<string, string> =>
  Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.slice(path.indexOf(dir) + dir.length), text]));
/** The one file of `raw`, absent when the glob matched nothing. */
const single = (raw: Readonly<Record<string, string>>): string | undefined => Object.values(raw)[0];

/** The checked-in pack the globs read. */
export function checkedInShapePack(globs: ShapePackGlobs): CheckedInShapePack {
  return {
    pack: below(globs.pack, '/pack/'),
    goldens: below(globs.goldens, '/__golden__/'),
    packageJson: single(globs.packageJson) ?? '',
    versions: single(globs.versions),
    changelog: single(globs.changelog),
  };
}

/** The shared test's body: compare `checkedIn` with the build of `source`, or, on a `write` run under `-u`, rewrite the files. */
export async function shapePackTest(source: DeclarativeShapePack, checkedIn: CheckedInShapePack, write: boolean): Promise<void> {
  if (write) {
    expect(expect.getState().snapshotState.snapshotUpdateState, `${WRITE_VARIABLE}=1 needs \`vitest run -u\``).toBe('all');
    const expected = shapePackExpectation(source, checkedIn.versions);
    for (const [path, text] of Object.entries(expected.pack)) await expect(text).toMatchFileSnapshot(`../pack/${path}`);
    for (const [path, text] of Object.entries(expected.goldens)) await expect(text).toMatchFileSnapshot(`../__golden__/${path}`);
    await expect(expected.versions).toMatchFileSnapshot('../pack-versions.json');
    return;
  }
  expect(await checkShapePack(source, checkedIn)).toEqual({ files: [], loading: [], brands: [], bounds: [], versions: [] });
}

/**
 * Register the shared pack test in the enclosing `describe`: the checked-in files are the build of `source`, with no problem
 * (`checkShapePack`). A write run (see the top) rewrites `pack/`, `__golden__/` and `pack-versions.json` instead.
 *
 * @public
 */
export function testShapePack(source: DeclarativeShapePack, globs: ShapePackGlobs): void {
  const checkedIn = checkedInShapePack(globs);
  it('the checked-in files are the build of the exported source, with no problem', () => shapePackTest(source, checkedIn, writeRequested(runEnv())));
}
