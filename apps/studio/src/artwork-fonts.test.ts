// FR-LIB-004 FR-AST-003: the studio keeps a file's retained artwork fonts through open, save and crash recovery (ADR-0192, M18.115).
import { allowsShapePackContentLicense, type ShapePackSubset11 } from '@fluxion/core';
import { loadFlux, sha256Hex, writePortableFlux } from '@fluxion/format';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { createAutosave, recover } from './autosave/autosave.js';
import { memoryAutosaveStore } from './autosave/store.js';
import { fileRecoveryState } from './file-recovery.js';
import { fileBytes, openFileBytes } from './file-session.js';
import { recoveredEntry } from './recovery-host.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?inline' | '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const pack = Object.values(import.meta.glob('../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true }))[0];
const inline =
  Object.values(import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true }))[0] ??
  '';
const INTER = Uint8Array.from(atob(inline.slice(inline.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const SHA = sha256Hex(INTER);
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const loadOptions = { hasher, shapePackLicensePolicy: allowsShapePackContentLicense };
const timers = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
function document(ids: readonly QualifiedName[]) {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return b.build();
}
/** A `.flux` whose saved 1.1 pack draws text in exact Inter, retained as `assets/<sha>.woff2`. */
async function archive(): Promise<Uint8Array> {
  const subset = JSON.parse(pack ?? 'null') as ShapePackSubset11;
  const written = await writePortableFlux({
    document: document(['sample:label', 'sample:box']),
    appVersion: '0',
    hasher,
    shapePacks: {
      sources: [{ kind: 'embedded', subset, fonts: new Map([[SHA, INTER]]) }],
      builtinIds: new Set(),
      licensePolicy: allowsShapePackContentLicense,
    },
  });
  return value(written).bytes;
}
const save = { hasher, appVersion: '0', bytesOf: async () => undefined };

it('FR-LIB-004 FR-AST-003: an opened file keeps its retained artwork font bytes, and a save after an edit writes them again', async () => {
  const opened = value(await openFileBytes('label.flux', await archive(), hasher));
  expect([...(opened.artworkFonts ?? new Map())]).toEqual([[SHA, INTER]]);
  const saved = value(await fileBytes({ ...save, file: opened, document: document(['sample:label']) }));
  const back = value(await loadFlux(saved.bytes, loadOptions));
  expect(back.shapePacks.map((p) => [p.formatVersion, p.definitions.map((d) => d.id)])).toEqual([['1.1', ['sample:label']]]);
  expect(back.assets.get(SHA)?.bytes).toEqual(INTER);
  // a save without the bytes is refused rather than written with text that has no face
  expect((await fileBytes({ ...save, file: { ...opened, artworkFonts: new Map() }, document: document(['sample:label']) })).ok).toBe(false);
});

it('FR-FIL-007 FR-AST-003: crash recovery brings back the retained artwork font bytes, which have no asset record, so Save keeps them', async () => {
  const opened = value(await openFileBytes('label.flux', await archive(), hasher));
  const journal = memoryAutosaveStore();
  const records = opened.document.records;
  const options = { docId: 'doc1', store: journal, timers, iso: () => '2026-10-28T00:00:00Z', records: () => records, title: () => 'Label' };
  const autosave = createAutosave({ ...options, fileState: fileRecoveryState(opened), base: { records, seq: 0, rev: 0 } });
  const [id, record] = Object.entries(records).find(([, r]) => r.type === 'element') ?? [];
  if (id === undefined || record === undefined) throw new Error('fixture element missing');
  autosave.change({ puts: new Map([[id as never, { before: record, after: { ...record, opacity: 0.5 } }]]), deletes: new Map() }, 1);
  await autosave.flush();
  autosave.dispose();
  const stored = await journal.load('doc1');
  const recovery = stored && recover(stored);
  if (!recovery) throw new Error('recovery missing');
  const entry = await recoveredEntry({ id: 'doc1', recovery }, {});
  expect([...(entry.file.artworkFonts ?? new Map())]).toEqual([[SHA, INTER]]);
  const saved = value(await fileBytes({ ...save, file: entry.file, document: entry.file.document }));
  expect(value(await loadFlux(saved.bytes, loadOptions)).assets.get(SHA)?.bytes).toEqual(INTER);
});
