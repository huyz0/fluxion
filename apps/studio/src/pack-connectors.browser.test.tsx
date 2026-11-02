import { embeddedConnectors, sha256Hex } from '@fluxion/format';
import { PlayerRoot } from '@fluxion/player';
import { connectorDefOf, registerConnectorDefs } from '@fluxion/routing';
import type { DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { type OpenDocument, openDocument } from './bootstrap.js';
import { fileBytes, openFileBytes } from './file-session.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
// the pack the document was drawn with; the reopening studio does not have it
const LINES = {
  format: 'fluxion-connector-defs',
  formatVersion: '1.0',
  definitions: [
    { id: 'lines:wavy', router: 'orthogonal', decoration: { kind: 'wavy', amplitude: 3, wavelength: 12 }, name: 'Wavy' },
    { id: 'lines:pipe', router: 'orthogonal', decoration: { kind: 'pipe', wall: 2 }, name: 'Pipe' },
  ],
};

/** Two shapes joined by a wavy pack connector. */
function joined(): DocumentFile {
  const b = documentBuilder({ seed: 112 });
  const screen = b.screen({ size: { w: 400, h: 240 } });
  const a = b.rect(screen, { x: 20, y: 20, w: 80, h: 50 });
  const c = b.rect(screen, { x: 280, y: 160, w: 80, h: 50 });
  b.connect(a, c, { route: 'lines:wavy', sourceAnchor: { kind: 'side', side: 'e' }, targetAnchor: { kind: 'side', side: 'w' } });
  return b.build();
}

/** The `d` of every decoration stroke the player draws for `opened`. */
async function strokes(opened: OpenDocument): Promise<string[]> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PlayerRoot store={opened.core.store} registries={opened.registries} />));
    await expect.poll(() => host.querySelectorAll('[data-part]').length).toBeGreaterThan(0);
    return [...host.querySelectorAll('[data-part]')].map((p) => `${p.getAttribute('data-part')} ${p.getAttribute('d')}`);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

describe('pack connector types in a saved file (FR-CON-010, FR-LIB-009)', () => {
  it('FR-CON-010, FR-LIB-009: WHEN a document using a pack connector type is saved and reopened without the pack THE SYSTEM SHALL draw the same decoration', async () => {
    const withPack = openDocument(joined());
    if (!withPack.ok) throw new Error(withPack.error);
    const pack = registerConnectorDefs(withPack.value.registries.routers, LINES, 'lines');
    expect(pack.ok).toBe(true);
    const drawn = await strokes(withPack.value);

    const saved = await fileBytes({
      file: undefined,
      document: withPack.value.core.store.toDocument(),
      bytesOf: () => Promise.resolve(undefined),
      hasher,
      appVersion: '1.0.0',
      connectorDefOf: (type) => connectorDefOf(withPack.value.registries.routers, type),
    });
    if (!saved.ok) throw new Error(saved.error);
    const reopened = await openFileBytes('wavy.flux', saved.value.bytes, hasher);
    if (!reopened.ok) throw new Error(reopened.error);
    // only the type the document uses travels
    expect([...reopened.value.extraEntries.keys()]).toEqual(['connectors/lines.json']);
    const connectors = embeddedConnectors(reopened.value.extraEntries);
    expect(connectors.map((c) => c.pack)).toEqual(['lines']);

    const withoutPack = openDocument(reopened.value.document, { connectors });
    if (!withoutPack.ok) throw new Error(withoutPack.error);
    expect(withoutPack.value.registries.routers.get('lines:pipe')).toBeUndefined();
    expect(connectorDefOf(withoutPack.value.registries.routers, 'lines:wavy')).toEqual(LINES.definitions[0]);
    expect(await strokes(withoutPack.value)).toEqual(drawn);
    expect(drawn.some((s) => s.startsWith('line '))).toBe(true);
  });

  it('FR-LIB-009: an embedded entry this studio refused on open is kept by the next save, never dropped', async () => {
    const future = new TextEncoder().encode(JSON.stringify({ ...LINES, formatVersion: '1.1' }));
    const first = await fileBytes({ file: undefined, document: joined(), bytesOf: () => Promise.resolve(undefined), hasher, appVersion: '1.0.0' });
    if (!first.ok) throw new Error(first.error);
    const opened = await openFileBytes('wavy.flux', first.value.bytes, hasher);
    if (!opened.ok) throw new Error(opened.error);
    const file = { ...opened.value, extraEntries: new Map([['connectors/lines.json', future]]) };
    const doc = openDocument(file.document, { connectors: embeddedConnectors(file.extraEntries) });
    if (!doc.ok) throw new Error(doc.error);
    expect(doc.value.registries.routers.get('lines:wavy')).toBeUndefined();
    const saved = await fileBytes({
      file,
      document: doc.value.core.store.toDocument(),
      bytesOf: () => Promise.resolve(undefined),
      hasher,
      appVersion: '1.0.0',
      connectorDefOf: (type) => connectorDefOf(doc.value.registries.routers, type),
    });
    if (!saved.ok) throw new Error(saved.error);
    const again = await openFileBytes('wavy.flux', saved.value.bytes, hasher);
    if (!again.ok) throw new Error(again.error);
    expect(again.value.extraEntries.get('connectors/lines.json')).toEqual(future);
  });

  it('FR-CON-010: a refused embedded entry is logged and its connectors are drawn as an unknown type, the document still opens', () => {
    const logged: unknown[] = [];
    const logger = { log: (...args: unknown[]) => void logged.push(args) } as never;
    const opened = openDocument(joined(), { logger, connectors: [{ pack: 'lines', input: { format: 'nope' } }] });
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.registries.routers.get('lines:wavy')).toBeUndefined();
    expect(logged.some((l) => (l as unknown[])[0] === 'warn')).toBe(true);
  });
});
