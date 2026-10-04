import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFluxHtml, sha256Hex, writeFlux } from '@fluxion/format';
import { parseDocument } from '@fluxion/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion, REPO } from './spawn-bin.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fluxion-convert-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A `.flux` of the two-rects-line fixture, written to `dir`. */
async function fluxFile(name = 'deck.flux'): Promise<string> {
  const parsed = parseDocument(readFileSync(join(REPO, 'fixtures/docs/two-rects-line.flux.json'), 'utf8'));
  if (!parsed.ok) throw new Error('the fixture does not parse');
  const written = await writeFlux({ document: parsed.value.document, appVersion: '1.0.0', hasher });
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
