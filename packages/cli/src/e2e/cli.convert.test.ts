import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFlux, readFluxHtml, sha256Hex, writeFlux } from '@fluxion/format';
import { parseDocument } from '@fluxion/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion, REPO } from './spawn-bin.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fluxion-convert-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A `.flux` of the two-rects-line fixture, written to `dir`. */
async function fluxFile(name = 'deck.flux', withAsset = false): Promise<string> {
  const parsed = parseDocument(readFileSync(join(REPO, 'fixtures/docs/two-rects-line.flux.json'), 'utf8'));
  if (!parsed.ok) throw new Error('the fixture does not parse');
  const assets = withAsset ? new Map([[sha256Hex(PNG), { bytes: PNG, mime: 'image/png' }]]) : undefined;
  const written = await writeFlux({ document: parsed.value.document, appVersion: '1.0.0', hasher, source: 'flux: 1\n', ...(assets ? { assets } : {}) });
  if (!written.ok) throw new Error(written.error.reason);
  const path = join(dir, name);
  writeFileSync(path, written.value);
  return path;
}

type Reply = { ok: boolean; result?: { from: string; to: string; direction: string; bytes: number }; errors?: { code: string; message: string }[] };
/** `fluxion convert … --json`: the exit status and the reply, parsed by the convert schema. */
function convert(...args: string[]) {
  const r = fluxion(['convert', ...args, '--json']);
  const parsed = OUTPUT_SCHEMAS['convert']?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as Reply };
}

/** `.flux` → `.flux.json` → `.flux` → `.flux.json`, with inline or external assets: the same document, then the same JSON bytes. */
async function roundTrip(flux: string, document: unknown, external: boolean): Promise<void> {
  const json = join(dir, external ? 'ext.flux.json' : 'deck.flux.json');
  const back = join(dir, external ? 'ext-back.flux' : 'back.flux');
  const there = convert(flux, json, ...(external ? ['--assets', 'external'] : []));
  expect(there.status).toBe(0);
  expect(there.reply.result).toMatchObject({ direction: 'to-json', bytes: readFileSync(json).length });
  const text = readFileSync(json, 'utf8');
  expect(text).toContain('"fluxion": "1.0"');
  expect(text.includes('base64')).toBe(!external);
  expect(existsSync(join(dir, `ext.assets/${sha256Hex(PNG)}.png`))).toBe(external);
  const home = convert(json, back);
  expect(home.status).toBe(0);
  expect(home.reply.result).toMatchObject({ direction: 'from-json' });
  const reopened = await loadFlux(readFileSync(back), { hasher });
  if (!reopened.ok) throw new Error(reopened.error.message);
  expect(reopened.value.document).toEqual(document);
  expect(reopened.value.source).toBe('flux: 1\n');
  expect(Uint8Array.from(reopened.value.assets.get(sha256Hex(PNG))?.bytes ?? [])).toEqual(PNG);
  // the JSON written again from the round-tripped .flux is the same bytes
  const again = join(dir, external ? 'ext2.flux.json' : 'again.flux.json');
  convert(back, again, ...(external ? ['--assets', 'external'] : []));
  expect(readFileSync(again, 'utf8').replace(/ext2\.assets/g, 'ext.assets')).toBe(text);
}

describe('fluxion convert (FR-FIL-003, FR-CLI-001, ADR-0155)', { timeout: E2E_TIMEOUT }, () => {
  it('FR-FIL-003: fluxion convert turns a .flux into a .flux.html and back to the same bytes', async () => {
    const flux = await fluxFile();
    const html = join(dir, 'deck.flux.html');
    const back = join(dir, 'back.flux');
    const there = convert(flux, html);
    expect(there.status).toBe(0);
    expect(there.reply.result).toMatchObject({ from: flux, to: html, direction: 'to-html' });
    const page = readFileSync(html, 'utf8');
    // a page with the player and the archive in it, and a title from the document
    expect(page).toContain('id="fluxion-player"');
    expect(page).toContain('id="fluxion-package"');
    expect(page).toMatch(/<title>[^<]+<\/title>/);
    const home = convert(html, back);
    expect(home.status).toBe(0);
    expect(home.reply.result).toMatchObject({ direction: 'to-flux' });
    expect(readFileSync(back).equals(readFileSync(flux))).toBe(true);
    expect(home.reply.result?.bytes).toBe(readFileSync(flux).length);
    // and the page's archive is what a reader finds in it
    const found = await readFluxHtml(page, hasher);
    expect(found.ok && Buffer.from(found.value).equals(readFileSync(flux))).toBe(true);
  });

  it('FR-FIL-005: fluxion convert turns a .flux into a .flux.json and back to the same document, inline or with external assets', async () => {
    const flux = await fluxFile('deck.flux', true);
    const opened = await loadFlux(readFileSync(flux), { hasher });
    if (!opened.ok) throw new Error(opened.error.message);
    for (const external of [false, true]) await roundTrip(flux, opened.value.document, external);
  });

  it('FR-CLI-001: a bad --assets value, --assets on another output, and a .flux.html with a .flux.json are usage errors', async () => {
    const flux = await fluxFile();
    for (const args of [
      [flux, join(dir, 'a.flux.json'), '--assets', 'zip'],
      [flux, join(dir, 'a.flux.html'), '--assets', 'external'],
      [join(dir, 'a.flux.html'), join(dir, 'a.flux.json')],
    ]) {
      const { status, reply } = convert(...args);
      expect(status, args.join(' ')).toBe(2);
      expect(reply.errors?.[0]?.code).toBe('FLX_CLI_USAGE');
    }
    expect(existsSync(join(dir, 'a.flux.json'))).toBe(false);
  });

  it('FR-CLI-001: a pair that is not one .flux and one .flux.html, or the wrong number of files, is a usage error and writes nothing', async () => {
    const flux = await fluxFile();
    const same = join(dir, 'other.flux');
    const odd = join(dir, 'notes.txt');
    for (const args of [[flux, same], [flux, odd], [odd, flux], [flux], [flux, join(dir, 'a.flux.html'), join(dir, 'b.flux')]]) {
      const { status, reply } = convert(...args);
      expect(status, args.join(' ')).toBe(2);
      expect(reply.errors?.[0]?.code).toBe('FLX_CLI_USAGE');
    }
    expect([existsSync(same), existsSync(join(dir, 'a.flux.html'))]).toEqual([false, false]);
  });

  it('FR-FIL-003: an input that is missing, not a .flux, or a page with no archive is an IO error (exit 1) and writes nothing', () => {
    const out = join(dir, 'out.flux.html');
    const back = join(dir, 'out.flux');
    writeFileSync(join(dir, 'bad.flux'), 'not a zip');
    writeFileSync(join(dir, 'plain.flux.html'), '<!doctype html><title>x</title><p>no archive</p>');
    for (const [input, output] of [
      [join(dir, 'missing.flux'), out],
      [join(dir, 'bad.flux'), out],
      [join(dir, 'plain.flux.html'), back],
    ] as const) {
      const { status, reply } = convert(input, output);
      expect(status, input).toBe(1);
      expect(reply.errors?.[0]?.code, input).toBe('FLX_CLI_IO');
    }
    expect([existsSync(out), existsSync(back)]).toEqual([false, false]);
  });

  it('FR-FIL-003: an output that cannot be written is an IO error', async () => {
    const { status, reply } = convert(await fluxFile(), join(dir, 'no-such-folder', 'deck.flux.html'));
    expect(status).toBe(1);
    expect(reply.errors?.[0]?.code).toBe('FLX_CLI_IO');
  });
});
