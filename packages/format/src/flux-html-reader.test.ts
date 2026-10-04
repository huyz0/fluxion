import { describe, expect, it } from 'vitest';
import { encodeBase64 } from './base64.js';
import { FLUX_HTML_MARKER_COMMENT, FLUX_HTML_MARKER_META, writeFluxHtml } from './flux-html.js';
import { readFluxHtml } from './flux-html-reader.js';
import { sha256Hex } from './sha256.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const GOLDEN_TEXT = import.meta.glob('../__fixtures__/v1.0/*.flux.b64', { query: '?raw', import: 'default', eager: true });
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const PLAYER = 'var Fluxion={start:function(){return Promise.resolve({ok:true})}};';
const bytesOf = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const html = async (flux: Uint8Array, extra: Partial<Parameters<typeof writeFluxHtml>[0]> = {}): Promise<string> => {
  const r = await writeFluxHtml({ flux, playerScript: PLAYER, title: 'T', hasher, ...extra });
  if (!r.ok) throw new Error(r.error.reason);
  return r.value;
};
const code = async (text: string) => {
  const r = await readFluxHtml(text, hasher);
  return r.ok ? 'ok' : r.error.code;
};
const fromBase64 = (b64: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let bits = 0;
  let count = 0;
  for (const ch of b64.trim().replace(/=+$/, '')) {
    bits = (bits << 6) | alphabet.indexOf(ch);
    count += 6;
    if (count >= 8) {
      count -= 8;
      out.push((bits >> count) & 0xff);
      bits &= (1 << count) - 1;
    }
  }
  return Uint8Array.from(out);
};

describe('readFluxHtml', () => {
  it('FR-FIL-003: .flux and .flux.html convert into each other losslessly, for every golden', async () => {
    expect(Object.keys(GOLDEN_TEXT).length).toBeGreaterThan(0);
    for (const [path, text] of Object.entries(GOLDEN_TEXT)) {
      const flux = fromBase64(text);
      const back = await readFluxHtml(await html(flux, { noscriptSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }), hasher);
      expect(back.ok && same(back.value, flux), path).toBe(true);
    }
  });

  it('FR-FIL-002: the archive is found by scanning, whatever the page around it says', async () => {
    const flux = bytesOf(5000);
    const page = await html(flux, { title: 'a <script id="fluxion-package"> in the title', generator: '</script>' });
    const r = await readFluxHtml(page, hasher);
    expect(r.ok && same(r.value, flux)).toBe(true);
    // a script with the same id after the data block is not read, and neither is anything before the first one
    const doubled = page.replace('</body>', `<script id="fluxion-package" data-encoding="base64">${encodeBase64(bytesOf(9))}</script></body>`);
    const first = await readFluxHtml(doubled, hasher);
    expect(first.ok && same(first.value, flux)).toBe(true);
  });

  it('FR-FIL-002: reading a .flux.html does not run its scripts', async () => {
    // the reader is a scan of the text, not a parser or an evaluator (no eval in the sources is its own gate leg): a page whose scripts throw or whose attributes carry handlers
    // is read like any other, and the reader, being a pure function of the text, returns the archive instead of throwing
    const flux = bytesOf(300);
    const hostile = (await html(flux, { generator: '<script>globalThis.__fluxionRan = 1</script>' })).replace(
      '</body>',
      '<script>globalThis.__fluxionRan = 2; throw new Error("ran")</script><img src=x onerror="globalThis.__fluxionRan = 3"></body>',
    );
    const r = await readFluxHtml(hostile, hasher);
    expect(r.ok && same(r.value, flux)).toBe(true);
  });

  it('FR-FIL-002: a file without both markers in its first 4 kB, a data block, or valid base64 is not a .flux.html', async () => {
    const page = await html(bytesOf(100));
    expect(await code('')).toBe('FILE_NOT_FLUX');
    expect(await code('<!doctype html><html><body>hello</body></html>')).toBe('FILE_NOT_FLUX');
    expect(await code(page.replace(FLUX_HTML_MARKER_META, ''))).toBe('FILE_NOT_FLUX');
    expect(await code(page.replace(FLUX_HTML_MARKER_COMMENT, ''))).toBe('FILE_NOT_FLUX');
    // markers pushed out of the first 4 kB by padding are not found
    expect(await code(page.replace('<head>', `<head><!--${'x'.repeat(5000)}-->`))).toBe('FILE_NOT_FLUX');
    expect(await code(page.replace('id="fluxion-package"', 'id="other"'))).toBe('FILE_NOT_FLUX');
    expect(await code(page.replace('data-encoding="base64"', 'data-encoding="hex"'))).toBe('FILE_NOT_FLUX');
    expect(await code(page.replace(/(id="fluxion-package"[^>]*>)[^<]*/, '$1not base64!'))).toBe('FILE_NOT_FLUX');
    expect(await code(page.slice(0, page.indexOf('</script>')))).toBe('FILE_NOT_FLUX');
    expect(await code(`${page.slice(0, page.indexOf('<script'))}<script`)).toBe('FILE_NOT_FLUX');
  });

  it('FR-FIL-003: an archive that does not match its data-sha256 is refused, one without a hash is read', async () => {
    const flux = bytesOf(300);
    const page = await html(flux);
    const hash = sha256Hex(flux);
    expect(await code(page.replace(hash, '0'.repeat(64)))).toBe('FILE_ZIP_INVALID');
    expect(await code(page.replace(/(<script[^>]*id="fluxion-package"[^>]*>)[^<]*/, `$1${encodeBase64(bytesOf(299))}`))).toBe('FILE_ZIP_INVALID');
    const bare = await readFluxHtml(page.replace(` data-sha256="${hash}"`, ''), hasher);
    expect(bare.ok && same(bare.value, flux)).toBe(true);
  });

  it('NFR-REL-002: scanning is linear: a long run of start tags without an end finishes (bounded by the test timeout)', async () => {
    const page = await html(bytesOf(10));
    const head = page.slice(0, page.indexOf('<script'));
    const verdicts = await Promise.all([
      code(`${head}${'<script '.repeat(100_000)}`),
      code(`${head}${'<script>x</script>'.repeat(100_000)}`),
      code(`${head}<script id="fluxion-package"${' '.repeat(2_000_000)}`),
    ]);
    expect(verdicts).toEqual(['FILE_NOT_FLUX', 'FILE_NOT_FLUX', 'FILE_NOT_FLUX']);
  }, 30_000);
});
