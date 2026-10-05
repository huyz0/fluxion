import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-SIZE-003 (ADR-0157): a typical 20-screen document without photos is at most DOC20_FLUX_HTML_BYTES as a `.flux.html`, measured gzip: what is downloaded or sent. The page is made from the built
// one-file player and fixtures/docs/doc20.flux.json, as the other specs make theirs. (The `.flux` leg, DOC20_FLUX_BYTES, is a Vitest test in packages/format.)

/** A bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
function threshold(name: string): number {
  const text = readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8');
  return Number(new RegExp(`${name}: \\{ value: ([\\d_]+)`).exec(text)?.[1]?.replaceAll('_', ''));
}

test.describe('the size of a 20-screen .flux.html', { tag: '@desktop' }, () => {
  test('NFR-SIZE-003: the 20-screen document in .flux.html is within DOC20_FLUX_HTML_BYTES (gzip)', async () => {
    const html = await fluxHtmlOf('doc20', { title: 'Twenty screens' });
    const raw = Buffer.byteLength(html, 'utf8');
    const gzip = gzipSync(Buffer.from(html, 'utf8'), { level: 9 }).length;
    const limit = threshold('DOC20_FLUX_HTML_BYTES');
    expect(limit).toBe(450_000);
    expect(gzip, `${gzip} bytes gzip (${raw} raw)`).toBeLessThanOrEqual(limit);
    // the page carries a whole player: it is far bigger raw than gzip, which is why the basis matters
    expect(raw).toBeGreaterThan(gzip);
  });
});
