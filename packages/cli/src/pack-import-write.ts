// The atomic output of a `pack-import` (ADR-0206): the pack is written to a temporary sibling of `-o`, read back from disk through
// the version-aware artwork loader (every definition acquired, fonts verified), and only then renamed to `-o`. Any failure removes
// the temporary directory, so `-o` holds a checked pack or nothing.

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { sha256Hex } from '@fluxion/format';
import { allowsShapePackContentLicense, createArtworkShapePackLoader } from '@fluxion/sdk';

/** Why the pack directory read back from `dir` does not load, or undefined when every definition does. */
export async function packProblem(dir: string): Promise<string | undefined> {
  const index = new Uint8Array(await readFile(join(dir, 'index.json')));
  const loader = await createArtworkShapePackLoader(index, {
    maxBytes: 256 * 1024 * 1024,
    read: async (path) => new Uint8Array(await readFile(join(dir, ...path.split('/')))),
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    licensePolicy: allowsShapePackContentLicense,
  });
  if (!loader.ok) return loader.error.map((d) => `${d.path} ${d.message}`).join('; ');
  for (const entry of loader.value.index.definitions) {
    const acquired = await loader.value.acquire(entry.id);
    if (!acquired.ok) return acquired.error.map((d) => `${entry.id}: ${d.message}`).join('; ');
  }
  return undefined;
}

/** Write `files` (pack-relative path → bytes) as the directory `out`, atomically; the reason when it is not written. */
export async function writePackDir(out: string, files: ReadonlyMap<string, Uint8Array>): Promise<string | undefined> {
  let temp: string | undefined;
  try {
    temp = await mkdtemp(join(dirname(out), `.${basename(out)}.partial-`));
    for (const [path, bytes] of files) {
      const target = join(temp, ...path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    const problem = await packProblem(temp);
    if (problem !== undefined) return `the written pack does not load: ${problem}`;
    // rename replaces an empty directory, so one that appeared meanwhile is refused rather than taken over
    if (existsSync(out)) return `${out} appeared while the pack was written`;
    await rename(temp, out);
    temp = undefined;
    return undefined;
  } catch (e) {
    return `cannot write ${out}: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (temp !== undefined) await rm(temp, { recursive: true, force: true });
  }
}
