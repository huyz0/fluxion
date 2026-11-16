// Shared by the cli.pack-import*.test.ts files (split at M19.59 so Vitest runs them in parallel): the frozen corpus, the built
// `fluxion pack-import`, the corpus's declared rights as a --credits file, and a temporary directory per test file.
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZip } from '@fluxion/format';
import { fluxion, REPO, witnessAdvisories } from './spawn-bin.js';

export const CORPUS: string = join(REPO, 'specs/import/corpus');
/** A fresh temporary directory for a test file; the file removes it after its tests. */
export const testDir = (): string => mkdtempSync(join(tmpdir(), 'fluxion-pack-import-e2e-'));

export type Manifest = {
  readonly sources: readonly {
    id: string;
    repository?: string;
    commit?: string;
    license: string;
    attribution: string;
    notice: string;
    originalStatement?: string;
  }[];
  readonly svg: readonly { path: string; source: string; sha256: string; upstreamPath?: string }[];
};
export const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest;
export const member = (path: string): string => path.slice('svg/'.length);
/** `fluxion pack-import`, echoing the CLI's WITNESS_CLEANUP lines whether it succeeds or fails, so each slow close is in the ci log (M18.201). */
export function packImport(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ReturnType<typeof fluxion> {
  const r = fluxion(['pack-import', ...args], REPO, env);
  for (const line of witnessAdvisories(r.stderr)) process.stdout.write(`${line}\n`);
  return r;
}

/** The first mark of each phase a run printed with FLUXION_PACK_IMPORT_PHASES, in ms from its process's start (M18.229). */
export type Marks = { start?: number; 'witness-start'?: number; 'witness-ready'?: number; disposed?: number; end?: number };
export function phasesOf(stderr: string): Marks {
  const marks: Record<string, number> = {};
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith('PACK_IMPORT_PHASE ')) continue;
    const { phase, ms } = JSON.parse(line.slice('PACK_IMPORT_PHASE '.length)) as { phase: string; ms: number };
    marks[phase] ??= ms;
  }
  return marks as Marks;
}

/**
 * The corpus's declared rights as a `--credits` file: one upstream credit per Lucide member, pinned to its upstream path at the
 * manifest commit and to its manifest hash, and one original credit for the Fluxion members (ADR-0206).
 */
export function creditsFile(dir: string): string {
  const source = (id: string) => manifest.sources.find((s) => s.id === id) as Manifest['sources'][number];
  const lucide = source('lucide');
  const original = source('fluxion-original');
  const upstream = manifest.svg
    .filter((e) => e.source === 'lucide')
    .map((e) => ({
      id: member(e.path).replace(/\.svg$/, ''),
      license: lucide.license,
      attribution: lucide.attribution,
      noticeFile: lucide.notice,
      source: { kind: 'upstream', reference: `${lucide.repository}@${lucide.commit}:${e.upstreamPath}`, sha256: e.sha256 },
      members: [member(e.path)],
    }));
  const own = {
    id: 'fluxion',
    license: original.license,
    attribution: original.attribution,
    noticeFile: original.notice,
    source: { kind: 'original', author: 'Fluxion contributors', statement: original.originalStatement },
    members: manifest.svg.filter((e) => e.source === 'fluxion-original').map((e) => member(e.path)),
  };
  const path = join(dir, 'credits.json');
  writeFileSync(
    path,
    JSON.stringify({ license: 'ISC AND MIT', attribution: 'Lucide Icons and Contributors; Fluxion contributors', credits: [...upstream, own] }),
  );
  // notice files resolve beside the credits file, so it is copied next to the corpus licenses
  cpSync(join(CORPUS, 'licenses'), join(dir, 'licenses'), { recursive: true });
  return path;
}

export const corpusZip = (dir: string): string => {
  const svg = join(CORPUS, 'svg');
  const zip = writeZip(
    readdirSync(svg)
      .sort()
      .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(svg, name))) })),
  );
  if (!zip.ok) throw new Error(zip.error.reason);
  const path = join(dir, 'corpus.zip');
  writeFileSync(path, zip.value);
  return path;
};
export const meta = (out: string): string[] => ['-o', out, '--namespace', 'corpus', '--version', '1.0.0', '--name', 'Import corpus', '--json'];

/** Every file under `root` by relative path, as base64. */
export const tree = (root: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(root.length + 1))
      .sort()
      .map((p) => [p, readFileSync(join(root, p), 'base64')]),
  );
