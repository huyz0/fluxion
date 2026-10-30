// `fluxion convert --subset-fonts` (FR-AST-003, ADR-0051, ADR-0201, M18.40): the `.flux` a conversion writes carries used-glyph WOFF2 subsets of
// its eligible embedded fonts. A candidate copy is written and reopened; only a candidate whose every subset reopens intact replaces the
// input's bytes, otherwise the input's own bytes are written and each font is reported as kept. Each font job runs in a fresh worker thread
// that is terminated when it answers or after 30 s, so a trap or a hang loses that font's subset only.
import { Worker } from 'node:worker_threads';
import {
  type ContentHasher,
  type FluxAsset,
  type FontJobWorker,
  type FontSubsetDeps,
  type FontSubsetLine,
  type LoadedFlux,
  loadFlux,
  referencedAssetHashes,
  runFontSubsetJob,
  type SubsetSave,
  subsetFontsForSave,
  writePortableFlux,
} from '@fluxion/format';
import { basicPack } from '@fluxion/pack-basic';
import { allowsShapePackContentLicense } from '@fluxion/sdk';
import { CLI_VERSION } from './version.js';

/** The built worker module beside this one (`dist/font-subset-worker.js`). */
const WORKER_URL = new URL('./font-subset-worker.js', import.meta.url);

/** A fresh worker thread, driven through the shape the job runner expects. */
export function threadWorker(url: URL = WORKER_URL): FontJobWorker {
  const thread = new Worker(url);
  const worker: FontJobWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => thread.postMessage(message),
    terminate: () => void thread.terminate(),
  };
  thread.on('message', (data: unknown) => worker.onmessage?.({ data }));
  thread.on('error', (e) => worker.onerror?.(e));
  thread.on('exit', (code) => worker.onerror?.(new Error(`the font worker exited with ${code}`)));
  return worker;
}

/** What a CLI subset needs: each font job in its own worker thread from `spawn`. */
export function cliSubsetDeps(hasher: ContentHasher, spawn: () => FontJobWorker = threadWorker): FontSubsetDeps {
  return { sha256: (bytes) => hasher.sha256(bytes), job: (input) => runFontSubsetJob(input, spawn, globalThis) };
}

/** What subsetting wrote: the `.flux` bytes and one line per embedded font. */
export type SubsetFlux = { readonly bytes: Uint8Array; readonly fonts: readonly FontSubsetLine[] };

const builtinIds: ReadonlySet<string> = new Set(basicPack.shapes.map((def) => def.id));
/** Saved shape packs open under the content policy, as `convert` opens them (M18.116). */
const OPEN = (hasher: ContentHasher) => ({ hasher, shapePackLicensePolicy: allowsShapePackContentLicense });

/** Shape ids the loaded document uses that neither the basic pack nor its embedded packs define: kept as they were. */
function unresolvedIds(loaded: LoadedFlux): ReadonlySet<string> {
  const known = new Set([...builtinIds, ...loaded.shapePacks.flatMap((pack) => pack.definitions.map((def) => def.id))]);
  const out = new Set<string>();
  for (const record of Object.values(loaded.document.records) as readonly { type?: unknown; kind?: unknown; defId?: unknown }[])
    if (record.type === 'element' && record.kind === 'shape' && typeof record.defId === 'string' && !known.has(record.defId)) out.add(record.defId);
  return out;
}

/** The input's font bytes by hash: a saved 1.1 pack's exact artwork fonts are among them and are written unchanged (ADR-0192). */
function heldFonts(loaded: LoadedFlux): ReadonlyMap<string, Uint8Array> {
  return new Map([...loaded.assets].flatMap(([hash, asset]) => (asset.mime.startsWith('font/') ? [[hash, asset.bytes] as const] : [])));
}

/** The candidate written as a `.flux` keeping everything else the input held: source, cover, packs, plugins, entries and manifest fields. */
async function writeCandidate(loaded: LoadedFlux, candidate: SubsetSave, hasher: ContentHasher): Promise<Uint8Array | undefined> {
  const all = new Map<string, FluxAsset>([...loaded.assets, ...candidate.assets]);
  const fonts = heldFonts(loaded);
  const assets = new Map(referencedAssetHashes(candidate.document).flatMap((hash) => (all.has(hash) ? [[hash, all.get(hash) as FluxAsset]] : [])));
  const written = await writePortableFlux({
    document: candidate.document,
    assets,
    appVersion: CLI_VERSION,
    generator: 'fluxion convert',
    ...(loaded.source === undefined ? {} : { source: loaded.source }),
    ...(loaded.preview === undefined ? {} : { preview: loaded.preview }),
    extraEntries: loaded.extraEntries,
    manifestExtras: loaded.manifestExtras,
    plugins: loaded.manifest?.plugins ?? [],
    hasher,
    shapePacks: {
      sources: loaded.shapePacks.map((subset) => ({ kind: 'embedded' as const, subset, fonts })),
      builtinIds,
      licensePolicy: allowsShapePackContentLicense,
      preservedUnresolvedIds: unresolvedIds(loaded),
    },
  });
  return written.ok ? written.value.bytes : undefined;
}

/** Whether `bytes` reopen whole with every subset font's record pointing at WOFF2 bytes of exactly its hash. */
async function reopensIntact(bytes: Uint8Array, candidate: SubsetSave, hasher: ContentHasher): Promise<boolean> {
  const opened = await loadFlux(bytes, OPEN(hasher));
  if (!opened.ok || opened.value.salvage !== undefined || opened.value.notes.length > 0) return false;
  for (const line of candidate.report.filter((l) => l.status === 'subset')) {
    const record = opened.value.document.records[line.asset] as { hash?: string; mime?: string } | undefined;
    const held = record?.hash === undefined ? undefined : opened.value.assets.get(record.hash);
    if (held === undefined || record?.mime !== 'font/woff2' || (await hasher.sha256(held.bytes)) !== record.hash) return false;
  }
  return true;
}

/** The report of a candidate that was not written: every font stayed whole. */
const keptWhole = (report: readonly FontSubsetLine[]): FontSubsetLine[] =>
  report.map((l) =>
    l.status === 'subset'
      ? {
          asset: l.asset,
          name: l.name,
          before: l.before,
          after: l.before,
          status: 'kept',
          reason: 'engine-failure',
          message: 'the subset file did not reopen intact',
        }
      : l,
  );

/**
 * The `.flux` bytes `flux` becomes with its eligible fonts subset, or a one-line reason it cannot be rewritten (it does not open, or it was
 * written by a newer version and must not be saved over). When nothing is subset or the candidate does not reopen intact, the input's own
 * bytes come back unchanged.
 */
export async function subsetFlux(flux: Uint8Array, deps: FontSubsetDeps, hasher: ContentHasher): Promise<SubsetFlux | { readonly error: string }> {
  const loaded = await loadFlux(flux, OPEN(hasher));
  if (!loaded.ok) return { error: loaded.error.message };
  if (loaded.value.readOnly || loaded.value.salvage !== undefined) return { error: 'the file opens read-only or in part, so its fonts are not rewritten' };
  const candidate = await subsetFontsForSave(loaded.value.document, (hash) => loaded.value.assets.get(hash)?.bytes, deps);
  if (!candidate.report.some((l) => l.status === 'subset')) return { bytes: flux, fonts: candidate.report };
  const bytes = await writeCandidate(loaded.value, candidate, hasher);
  if (bytes !== undefined && (await reopensIntact(bytes, candidate, hasher))) return { bytes, fonts: candidate.report };
  return { bytes: flux, fonts: keptWhole(candidate.report) };
}
