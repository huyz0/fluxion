import { connectorDefOf, registerConnectorDefs } from '@fluxion/routing';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { type OpenDocument, openDocument } from './bootstrap.js';
import { usePackConnectors } from './use-document-catalog.js';

type Routers = OpenDocument['registries']['routers'];

/** Whether the hook says the document may be shown, and whether arrows:wavy was registered at that render. */
function Probe(props: { readonly routers: Routers; readonly entries?: ReadonlyMap<string, Uint8Array>; readonly seen: string[] }): null {
  const ready = usePackConnectors(props.routers, props.entries);
  props.seen.push(`${ready} ${props.routers.get('arrows:wavy') !== undefined}`);
  return null;
}

function opened(): OpenDocument {
  const b = documentBuilder({ seed: 251 });
  const s = b.screen();
  const [a, c] = [0, 1].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never];
  b.connect(a, c, { route: 'arrows:wavy' });
  const doc = openDocument(b.build());
  if (!doc.ok) throw new Error(doc.error);
  return doc.value;
}

async function mounted(routers: Routers, entries?: ReadonlyMap<string, Uint8Array>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const seen: string[] = [];
  await act(async () => root.render(<Probe routers={routers} seen={seen} {...(entries === undefined ? {} : { entries })} />));
  await expect.poll(() => seen.at(-1)).toMatch(/^true /);
  return {
    seen,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('the studio shows a document once the first-party connector types are in (M18.251)', () => {
  it("FR-CON-010, FR-LIB-009: the hook holds the document until arrows' types are registered, and closing releases them", async () => {
    const doc = opened();
    const view = await mounted(doc.registries.routers);
    // never shown without the types: every render that may show the document already has arrows:wavy
    expect(view.seen.filter((s) => s.startsWith('true '))).not.toContain('true false');
    expect(view.seen[0]).toBe('false false');
    expect(connectorDefOf(doc.registries.routers, 'arrows:wavy')?.decoration).toEqual({ kind: 'wavy', amplitude: 3, wavelength: 12 });
    view.unmount();
    expect(doc.registries.routers.get('arrows:wavy')).toBeUndefined();
  });

  it('FR-LIB-009: a file carrying its own arrows types keeps them; the bundled ones are not registered over them', async () => {
    const doc = opened();
    const saved = { id: 'arrows:wavy', router: 'orthogonal', decoration: { kind: 'wavy', amplitude: 6, wavelength: 20 } };
    const envelope = { format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [saved] };
    expect(registerConnectorDefs(doc.registries.routers, envelope, 'arrows').ok).toBe(true);
    const entries = new Map([['connectors/arrows.json', new TextEncoder().encode(JSON.stringify(envelope))]]);
    const view = await mounted(doc.registries.routers, entries);
    expect(connectorDefOf(doc.registries.routers, 'arrows:wavy')).toEqual(saved);
    expect(doc.registries.routers.get('arrows:pipe')).toBeUndefined();
    view.unmount();
    expect(connectorDefOf(doc.registries.routers, 'arrows:wavy')).toEqual(saved);
  });
});
