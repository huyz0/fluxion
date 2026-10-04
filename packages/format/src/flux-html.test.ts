import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64.js';
import { FLUX_HTML_BOOT, FLUX_HTML_MARKER_COMMENT, FLUX_HTML_MARKER_META, writeFluxHtml } from './flux-html.js';
import { sha256Hex } from './sha256.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const PLAYER = 'var Fluxion=(function(){return{start:function(b,r){r.textContent="ok";return Promise.resolve({ok:true})}}})();';
/** Bytes that look like an archive: LZ77-proof, so the payload is as big as it says. */
const archive = (n: number): Uint8Array => {
  let x = 7;
  return Uint8Array.from({ length: n }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x >>> 24;
  });
};
const write = async (extra: Partial<Parameters<typeof writeFluxHtml>[0]> = {}) => {
  const r = await writeFluxHtml({ flux: archive(3000), playerScript: PLAYER, title: 'A deck', hasher, ...extra });
  if (!r.ok) throw new Error(r.error.reason);
  return r.value;
};
/** The text of the script element with this id. */
const scriptText = (html: string, id: string): string => {
  const m = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  return m?.[1] ?? '';
};
const sha256Base64 = (text: string): string => {
  const hex = sha256Hex(encodeUtf8(text));
  return encodeBase64(Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16)));
};

describe('base64', () => {
  it('FR-FIL-002: base64 round-trips every length, matches the standard vectors, and refuses what is not base64', () => {
    for (const [text, b64] of [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ] as const) {
      expect(encodeBase64(encodeUtf8(text))).toBe(b64);
      expect(decodeUtf8(decodeBase64(b64) ?? new Uint8Array())).toBe(text);
    }
    for (let n = 0; n < 40; n++) expect(Array.from(decodeBase64(encodeBase64(archive(n))) ?? [])).toEqual(Array.from(archive(n)));
    expect(decodeBase64('Zm9v\nYmFy')).toBeDefined();
    for (const bad of ['Zm9', 'Zm9v!', '=Zm9', 'Zg=a', 'Z']) expect(decodeBase64(bad), bad).toBeUndefined();
  });
});

describe('writeFluxHtml', () => {
  it('FR-FIL-002: both re-import markers are in the first 4 kB of a .flux.html, however long the title and big the file', async () => {
    const html = await write({
      title: 'T'.repeat(5000),
      flux: archive(2_000_000),
      playerScript: `${PLAYER}${'/*'.padEnd(500_000, 'x')}*/`,
      generator: 'fluxion 1.4.0',
    });
    const first = encodeUtf8(html).slice(0, 4096);
    const head = decodeUtf8(first);
    expect(head).toContain(FLUX_HTML_MARKER_META);
    expect(head).toContain(FLUX_HTML_MARKER_COMMENT);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it("NFR-SEC-002: a .flux.html has one CSP meta with connect-src 'none' and the hashes of its scripts, and no other script or external reference", async () => {
    const html = await write({ noscriptSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>' });
    const csp = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)].map((m) => m[1] ?? '');
    expect(csp).toHaveLength(1);
    const policy = csp[0] ?? '';
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain(`'sha256-${sha256Base64(scriptText(html, 'fluxion-player'))}'`);
    expect(policy).toContain(`'sha256-${sha256Base64(scriptText(html, 'fluxion-boot'))}'`);
    expect(scriptText(html, 'fluxion-boot')).toBe(FLUX_HTML_BOOT);
    // three script elements: the data block, the player, the boot; nothing else runs and nothing is fetched
    expect([...html.matchAll(/<script[\s>]/g)]).toHaveLength(3);
    expect(html).toContain('<script type="application/octet-stream" id="fluxion-package"');
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/<(link|iframe|object|embed|img|base|form)[\s>]/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//);
  });

  it('FR-FIL-003: the data block is the archive in base64, hashed, and the same input gives the same text', async () => {
    const flux = archive(5000);
    const a = await write({ flux });
    const b = await write({ flux });
    expect(a).toBe(b);
    expect(Array.from(decodeBase64(scriptText(a, 'fluxion-package')) ?? [])).toEqual(Array.from(flux));
    expect(a).toContain(`data-sha256="${sha256Hex(flux)}"`);
    expect(a).toContain('data-encoding="base64"');
  });

  it('NFR-SEC-002: an end tag or a comment opener in the player script cannot end or hide its block, and the CSP hash covers what is written', async () => {
    const hostile = `var x="</script><script>alert(1)</script>";var y="<!--";var z=/<\\/SCRIPT/i;${PLAYER}`;
    const html = await write({ playerScript: hostile });
    // the block ends where it should: three end tags, and the boot script after it is read back whole (text inside a script block is inert)
    expect([...html.matchAll(/<\/script>/g)]).toHaveLength(3);
    expect(scriptText(html, 'fluxion-boot')).toBe(FLUX_HTML_BOOT);
    const written = scriptText(html, 'fluxion-player');
    expect(written).not.toMatch(/<\/script/i);
    expect(written).not.toContain('<!--');
    expect(html).toContain(`'sha256-${sha256Base64(written)}'`);
  });

  it('NFR-SEC-001: the no-script picture goes through the SVG sanitizer, and is left out when it cannot be made safe', async () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="1" height="1" onclick="x()"/></svg>';
    const html = await write({ noscriptSvg: hostile });
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '';
    expect(noscript).toContain('<rect');
    expect(noscript).not.toMatch(/<script|onload|onclick/i);
    const none = await write({ noscriptSvg: 'not an svg' });
    expect(/<noscript>([\s\S]*?)<\/noscript>/.exec(none)?.[1]).not.toContain('<svg');
    expect(await write()).toContain('<noscript><p>');
  });

  it('FR-FIL-002: a long generator or language cannot push the markers out of the first 4 kB', async () => {
    const html = await write({ generator: `g${'&'.repeat(5000)}`, lang: `en-${'a'.repeat(5000)}` });
    const head = decodeUtf8(encodeUtf8(html).slice(0, 4096));
    expect(head).toContain(FLUX_HTML_MARKER_META);
    expect(head).toContain(FLUX_HTML_MARKER_COMMENT);
    expect(html).toContain('<html lang="en">');
    expect(/<meta name="generator" content="([^"]*)">/.exec(html)?.[1]?.length).toBeLessThanOrEqual(200 * 5);
  });

  it('NFR-SEC-002: the script is written as the HTML parser reads it, so its CSP hash matches: CRLF, CR and NUL are normalised', async () => {
    const html = await write({ playerScript: `${PLAYER}\r\nvar a=1;\rvar b="\u0000";\r\n` });
    const written = scriptText(html, 'fluxion-player');
    expect(written.includes('\r') || written.includes('\0')).toBe(false);
    expect(written).toContain('var a=1;\nvar b="\ufffd";\n');
    expect(html).toContain(`'sha256-${sha256Base64(written)}'`);
  });

  it('FR-FIL-002: the title and generator are escaped, a bad language falls back to en, and an empty player is refused', async () => {
    const html = await write({ title: '</title><script>x</script> & "q"', generator: 'a"><b' });
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</title>');
    expect(html).toContain('<meta name="generator" content="a&quot;&gt;&lt;b">');
    expect((await write({ lang: 'pt-BR' })).startsWith('<!doctype html>\n<html lang="pt-BR">')).toBe(true);
    expect(await write({ lang: 'x" onload="' })).toContain('<html lang="en">');
    const refused = await writeFluxHtml({ flux: archive(10), playerScript: '  \n', title: 't', hasher });
    expect(refused.ok).toBe(false);
  });
});
