import { allowsShapePackContentLicense } from '@fluxion/core';
import { loadFlux, sha256Hex, writeFlux, writePortableFlux } from '@fluxion/format';
import type { Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { createAutosave, recover } from './autosave/autosave.js';
import { memoryAutosaveStore } from './autosave/store.js';
import { openDocument } from './bootstrap.js';
import { fileRecoveryState } from './file-recovery.js';
import { fileBytes, openFileBytes } from './file-session.js';
import { recoveredEntry } from './recovery-host.js';

const fixtures = import.meta.glob('../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const value = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const timers = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };

async function verifySaved(saved: { bytes: Uint8Array; diagnostics: readonly unknown[] }, legacy: boolean): Promise<void> {
  if (legacy) expect(saved.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_PACK_UNRESOLVED_PRESERVED' })]);
  else {
    const back = value(await loadFlux(saved.bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense }));
    expect(back.shapePacks[0]?.definitions.map((d) => d.id)).toEqual(['sample:box']);
    expect(back.manifest?.plugins).toContainEqual({ kind: 'future', id: 'opaque' });
    expect(back.extraEntries.get('future/data.bin')).toEqual(new Uint8Array([1, 255]));
  }
}

for (const legacy of [false, true]) {
  it(`FR-FIL-007 FR-LIB-009: repeated recovery preserves ${legacy ? 'original unresolved provenance' : 'geometry and opaque data'} without granting provenance to edited references`, async () => {
    const b = documentBuilder();
    const screen = b.screen();
    const shape = b.rect(screen, { defId: legacy ? 'legacy:missing' : 'sample:box' });
    const document = b.build();
    const subset = JSON.parse(Object.values(fixtures)[0] as string);
    const opaque = { kind: 'future', id: 'opaque' };
    const bytes = legacy
      ? value(await writeFlux({ document, hasher, appVersion: '0' }))
      : value(
          await writePortableFlux({
            document,
            hasher,
            appVersion: '0',
            plugins: [opaque],
            extraEntries: new Map([['future/data.bin', new Uint8Array([1, 255])]]),
            shapePacks: { sources: [{ kind: 'embedded', subset }], builtinIds: new Set(), licensePolicy: allowsShapePackContentLicense },
          }),
        ).bytes;
    const opened = value(await openFileBytes('test.flux', bytes, hasher));
    const journal = memoryAutosaveStore();
    const state = fileRecoveryState(opened);
    const options = { docId: 'doc1', store: journal, timers, iso: () => '2026-10-26T00:00:00Z', records: () => document.records, title: () => 'Recovered' };
    const first = createAutosave({ ...options, fileState: state, base: { records: document.records, seq: 0, rev: 0 } });
    // Caller mutation after start cannot expand the original provenance in the journal.
    (state.unresolvedShapeIds as Set<string>).add('legacy:new');
    const record = document.records[shape];
    if (!record) throw new Error('fixture shape missing');
    const changed = { ...record, opacity: 0.5 };
    first.change({ puts: new Map([[shape, { before: record, after: changed }]]), deletes: new Map() }, 1);
    await first.flush();
    first.dispose();
    for (let round = 0; round < 2; round++) {
      const stored = await journal.load('doc1');
      if (!stored) throw new Error('journal missing');
      const recovery = recover(stored);
      if (!recovery) throw new Error('recovery missing');
      const entry = await recoveredEntry({ id: 'doc1', recovery }, {});
      const host = value(openDocument(entry.file.document, { shapePacks: entry.file.shapePacks ?? [] }));
      if (!legacy) expect(host.core.registries.shapeDefs.get('sample:box')).toBeDefined();
      const save = { file: entry.file, document: entry.file.document, hasher, appVersion: '0', bytesOf: async () => undefined };
      const saved = value(await fileBytes(save));
      await verifySaved(saved, legacy);
      const missing = { ...changed, defId: 'legacy:new' };
      expect((await fileBytes({ ...save, document: { ...entry.file.document, records: { ...entry.file.document.records, [shape]: missing } } })).ok).toBe(
        false,
      );
      const resumed = createAutosave({ ...options, stored });
      resumed.change({ puts: new Map([[shape, { before: changed, after: changed }]]), deletes: new Map() }, round + 2);
      await resumed.flush();
      resumed.dispose();
    }
  });
}
