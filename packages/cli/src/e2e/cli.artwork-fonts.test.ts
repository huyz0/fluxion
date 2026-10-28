// FR-LIB-004 FR-AST-003: `fluxion render` draws a .flux file's saved artwork text only in its exact retained bytes, embedded under a
// private alias, and refuses the file when the bytes are missing; `convert` opens saved packs under the content policy (ADR-0192, M18.116).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, sha256Hex, writeFlux, writePortableFlux, writeZip } from '@fluxion/format';
import { parseDocument } from '@fluxion/schema';
import { allowsShapePackContentLicense } from '@fluxion/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { playwrightLauncher, renderPngs } from '../render-png.js';
import { E2E_TIMEOUT, fluxion, REPO } from './spawn-bin.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const INTER = new Uint8Array(readFileSync(join(REPO, 'packs/fonts-core/fonts/inter-latin-400-normal.woff2')));
const SHA = sha256Hex(INTER);
const ALIAS = `fx-artwork-${SHA}`;
const dir = mkdtempSync(join(tmpdir(), 'fluxion-artwork-fonts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A `.flux` whose saved 1.1 pack draws `sample:label`'s text ("API") in exact Inter, retained as `assets/<sha>.woff2`. */
async function archive(): Promise<Uint8Array> {
  const json = JSON.parse(readFileSync(join(REPO, 'fixtures/docs/minimal.flux.json'), 'utf8')) as { records: Record<string, { type: string; id: string }> };
  const screen = Object.values(json.records).find((r) => r.type === 'screen');
  if (!screen) throw new Error('fixture has no screen');
  const label = {
    id: 'ArtworkLabel01',
    type: 'element',
    kind: 'shape',
    screenId: screen.id,
    index: 'a0',
    defId: 'sample:label',
    transform: { x: 40, y: 40, w: 320, h: 160 },
  };
  const parsed = parseDocument(JSON.stringify({ ...json, records: { ...json.records, [label.id]: label } }));
  if (!parsed.ok) throw new Error('fixture does not parse');
  const subset = JSON.parse(readFileSync(join(REPO, 'fixtures/shape-pack/v1.1/subset.json'), 'utf8'));
  const written = await writePortableFlux({
    document: parsed.value.document,
    appVersion: '0',
    hasher,
    shapePacks: {
      sources: [{ kind: 'embedded', subset, fonts: new Map([[SHA, INTER]]) }],
      builtinIds: new Set(),
      licensePolicy: allowsShapePackContentLicense,
    },
  });
  if (!written.ok) throw new Error(written.error.reason);
  return written.value.bytes;
}
const file = async (name: string, bytes: Uint8Array) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

describe('fluxion render of a .flux with retained artwork fonts (M18.116)', () => {
  it('FR-AST-003: --format html embeds the exact bytes once under the alias, and the artwork text names only the alias', { timeout: E2E_TIMEOUT }, async () => {
    const out = join(dir, 'label.html');
    const r = fluxion(['render', await file('label.flux', await archive()), '-o', out, '--json']);
    expect(JSON.parse(r.stdout), r.stdout).toMatchObject({ ok: true, exitCode: 0, result: { screens: 1 } });
    const html = readFileSync(out, 'utf8');
    expect(html.split('@font-face').length - 1).toBe(1);
    expect(html).toContain(`font-family: "${ALIAS}"; src: url(data:font/woff2;base64,${Buffer.from(INTER).toString('base64')}) format("woff2")`);
    const text = /<text[^>]*>API<\/text>/.exec(html)?.[0] ?? '';
    expect(text).toContain(`font-family="${ALIAS}"`);
    expect(text).not.toContain('Inter');
  });

  it('FR-AST-003: --format png waits for the exact face: the glyphs differ from the same page without it', { timeout: 90_000 }, async () => {
    const flux = await file('label-png.flux', await archive());
    const shots = join(dir, 'shots');
    const r = fluxion(['render', flux, '--format', 'png', '-o', shots, '--json']);
    expect(JSON.parse(r.stdout), r.stdout).toMatchObject({ ok: true, exitCode: 0, result: { screens: 1 } });
    const [name] = readdirSync(shots);
    const exact = readFileSync(join(shots, name as string));
    // the same page with its @font-face removed draws "API" in a fallback face
    const html = join(dir, 'label-png.html');
    expect(fluxion(['render', flux, '-o', html]).status).toBe(0);
    const fallback = join(dir, 'fallback');
    const page = readFileSync(html, 'utf8').replace(/<style data-fx-artwork-fonts>[^<]*<\/style>/, '');
    const files = await renderPngs(page, [name?.replace(/\.png$/, '') as string], fallback, playwrightLauncher);
    if (!Array.isArray(files)) throw new Error(JSON.stringify(files));
    expect(Buffer.compare(exact, readFileSync(files[0] as string))).not.toBe(0);
  });

  it('FR-LIB-004: a file whose retained font is missing is refused, exit 1, and nothing is written', { timeout: E2E_TIMEOUT }, async () => {
    const entries = readZip(await archive());
    if (!entries.ok) throw new Error('zip');
    const kept = entries.value.filter((e) => e.name !== `assets/${SHA}.woff2`);
    const manifest = kept.find((e) => e.name === 'manifest.json');
    if (!manifest) throw new Error('no manifest');
    const json = JSON.parse(new TextDecoder().decode(manifest.bytes));
    delete json.entries[`assets/${SHA}.woff2`];
    const rewritten = kept.map((e) => (e === manifest ? { name: e.name, bytes: new TextEncoder().encode(JSON.stringify(json)) } : e));
    const zipped = writeZip(rewritten);
    if (!zipped.ok) throw new Error('zip');
    const out = join(dir, 'missing.html');
    const r = fluxion(['render', await file('missing.flux', zipped.value), '-o', out, '--json']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).errors[0].message).toMatch(/shape pack|font|asset/i);
    expect(() => readFileSync(out)).toThrow();
  });

  it('FR-LIB-004: convert keeps the saved pack in a .flux.html and refuses a .flux.json that would drop it', { timeout: E2E_TIMEOUT }, async () => {
    const flux = await file('convert.flux', await archive());
    const html = fluxion(['convert', flux, join(dir, 'convert.flux.html'), '--json']);
    expect(JSON.parse(html.stdout), html.stdout).toMatchObject({ ok: true });
    const json = fluxion(['convert', flux, join(dir, 'convert.flux.json'), '--json']);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout).errors[0].message).toContain('saved shape packs');
  });

  it('FR-CLI-001: a .flux opened only in part is refused, and container damage is reported with the page', { timeout: E2E_TIMEOUT }, async () => {
    const entries = readZip(await archive());
    if (!entries.ok) throw new Error('zip');
    const doc = entries.value.find((e) => e.name === 'document.json');
    if (!doc) throw new Error('no document');
    const json = JSON.parse(new TextDecoder().decode(doc.bytes));
    for (const r of Object.values(json.records) as { type: string; transform?: unknown }[]) if (r.type === 'element') r.transform = 'bad';
    const broken = writeZip(entries.value.map((e) => (e === doc ? { name: e.name, bytes: new TextEncoder().encode(JSON.stringify(json)) } : e)));
    const extra = writeZip([...entries.value, { name: 'future/unlisted.bin', bytes: new Uint8Array([1]) }]);
    if (!broken.ok || !extra.ok) throw new Error('zip');
    const part = fluxion(['render', await file('part.flux', broken.value), '-o', join(dir, 'part.html'), '--json']);
    expect(part.status).toBe(1);
    expect(JSON.parse(part.stdout).errors[0].message).toContain('opens only in part (invalid)');
    const noted = fluxion(['render', await file('noted.flux', extra.value), '-o', join(dir, 'noted.html'), '--json']);
    expect(JSON.parse(noted.stdout), noted.stdout).toMatchObject({
      ok: true,
      diagnostics: [{ code: 'FLX_CLI_IO', severity: 'warning', path: '/entries/future~1unlisted.bin' }],
    });
  });

  it('FR-CLI-001: images of a .flux are drawn from its own verified bytes', { timeout: E2E_TIMEOUT }, async () => {
    const png = new Uint8Array(readFileSync(join(REPO, 'apps/studio/public/icon-192.png')));
    const hash = sha256Hex(png);
    const json = JSON.parse(readFileSync(join(REPO, 'fixtures/docs/minimal.flux.json'), 'utf8')) as { records: Record<string, { type: string; id: string }> };
    const screen = Object.values(json.records).find((r) => r.type === 'screen');
    if (!screen) throw new Error('fixture has no screen');
    const asset = { id: 'Picture00000001', type: 'asset', hash, mime: 'image/png', size: png.length, name: 'icon.png', w: 192, h: 192 };
    const image = {
      id: 'ImageElement001',
      type: 'element',
      kind: 'image',
      screenId: screen.id,
      index: 'a0',
      assetId: asset.id,
      transform: { x: 10, y: 10, w: 96, h: 96 },
    };
    const parsed = parseDocument(JSON.stringify({ ...json, records: { ...json.records, [asset.id]: asset, [image.id]: image } }));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const written = await writeFlux({ document: parsed.value.document, appVersion: '0', hasher, assets: new Map([[hash, { bytes: png, mime: 'image/png' }]]) });
    if (!written.ok) throw new Error(written.error.reason);
    const out = join(dir, 'image.html');
    expect(fluxion(['render', await file('image.flux', written.value), '-o', out]).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  });
});
