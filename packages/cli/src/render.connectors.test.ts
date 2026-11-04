import { sha256Hex, writeFlux } from '@fluxion/format';
import { basicPack } from '@fluxion/pack-basic';
import { documentBuilder } from '@fluxion/schema/testing';
import { type ConnectorDef, definePack, type Pack } from '@fluxion/sdk';
import { describe, expect, it, vi } from 'vitest';
import { archivePage, staticPage } from './render.js';

const wavy = { id: 'fix:wavy', router: 'orthogonal', decoration: { kind: 'wavy', amplitude: 3, wavelength: 12 } } as ConnectorDef;
// the CLI's host with a fixture pack that carries a connector type, beside the bundled basic pack
const FIXTURE: Pack = definePack({ id: 'fix', connectors: [wavy] });
vi.mock('./host.js', async (actual) => {
  const host = await actual<typeof import('./host.js')>();
  return { ...host, hostRegistries: (packs?: readonly Pack[]) => host.hostRegistries(packs ?? [basicPack, FIXTURE]) };
});
const { hostRegistries } = await import('./host.js');

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
/** A document with one connector of `route` between two rectangles. */
function joined(route: string) {
  const b = documentBuilder({ seed: 252 });
  const screen = b.screen({ size: { w: 400, h: 240 } });
  const a = b.rect(screen, { x: 20, y: 20, w: 80, h: 50 });
  const c = b.rect(screen, { x: 280, y: 160, w: 80, h: 50 });
  b.connect(a, c, { route: route as never, sourceAnchor: { kind: 'side', side: 'e' }, targetAnchor: { kind: 'side', side: 'w' } });
  return b.build();
}
/** The decoration strokes a rendered page draws (render's connector view marks each with data-part). */
const parts = (html: string) => [...html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);
function html(page: Awaited<ReturnType<typeof archivePage>>): string {
  if ('exitCode' in page) throw new Error(JSON.stringify(page.diagnostics));
  return page.html;
}
async function archive(route: string, entries: Record<string, unknown>): Promise<Uint8Array> {
  const extraEntries = new Map(Object.entries(entries).map(([name, json]) => [name, new TextEncoder().encode(JSON.stringify(json))]));
  const written = await writeFlux({ document: joined(route), appVersion: '1.0.0', hasher, source: 'flux: 1\n', extraEntries });
  if (!written.ok) throw new Error(written.error.reason);
  return written.value;
}

describe('the CLI draws pack connector types (FR-CON-010, FR-LIB-009, M18.252)', () => {
  it("FR-CON-010: a loaded pack's connector type is registered after the built-in routers and drawn with its decoration", () => {
    const plain = html(staticPage(JSON.stringify(joined('orthogonal')), undefined, 'plain.flux.json'));
    expect(parts(plain)).toEqual([]);
    const page = staticPage(JSON.stringify(joined('fix:wavy')), undefined, 'wavy.flux.json');
    expect(parts(html(page))).toContain('line');
  });

  it("FR-CON-010: a pack whose connector types are refused is the pack's problem, like any pack registration", () => {
    const broken = definePack({ id: 'fix', connectors: [{ ...wavy, id: 'other:wavy' } as ConnectorDef] });
    const { problems } = hostRegistries([basicPack, broken]);
    expect(problems.map((d) => [d.code, d.path, d.message.startsWith('pack "fix": ')])).toEqual([['FLX_PACK_INVALID', '/connectors/0/id', true]]);
    expect(hostRegistries([basicPack]).problems).toEqual([]);
  });

  it('FR-LIB-009: a .flux carrying connectors/<pack>.json is drawn with its types, a type no loaded pack has', async () => {
    const lines = { format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [{ ...wavy, id: 'lines:wavy' }] };
    const page = await archivePage(await archive('lines:wavy', { 'connectors/lines.json': lines }), undefined, 'lines.flux');
    expect(parts(html(page))).toContain('line');
    expect('exitCode' in page ? [] : page.diagnostics.filter((d) => d.code === 'FLX_PACK_INVALID')).toEqual([]);
  });

  it('FR-CON-010: a refused embedded entry warns and draws the plain route; the file still renders', async () => {
    const future = { format: 'fluxion-connector-defs', formatVersion: '1.1', definitions: [{ ...wavy, id: 'lines:wavy' }] };
    const page = await archivePage(await archive('lines:wavy', { 'connectors/lines.json': future }), undefined, 'lines.flux');
    expect(parts(html(page))).toEqual([]);
    const warned = 'exitCode' in page ? [] : page.diagnostics.filter((d) => d.code === 'FLX_PACK_INVALID');
    expect(warned.map((d) => [d.severity, d.path])).toEqual([['warning', '/entries/connectors~1lines.json']]);
    expect(warned[0]?.message).toMatch(/^lines\.flux: the connector types of lines were refused \(.+\); its connectors are drawn as plain routes$/);
  });
});
