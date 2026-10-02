import { describe, expect, it } from 'vitest';
import { MAX_SVG_CHARS, sanitizeSvg } from './sanitize-svg.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the security corpus (docs/standards/security.md §7): every hostile SVG, named for its attack
const CORPUS = Object.entries(import.meta.glob('../../../specs/security/corpus/svg-*.svg', { query: '?raw', import: 'default', eager: true })).map(
  ([path, text]) => [path.split('/').at(-1) ?? path, text] as const,
);

/** What nothing that survives may contain: markup that runs, loads or links. */
const FORBIDDEN = [
  /<script/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /foreignobject/i,
  /<a[\s>]/i,
  /<image/i,
  /<style/i,
  /<set[\s>]/i,
  /<animate/i,
  /<iframe/i,
  /<!entity/i,
  /<!doctype/i,
  /https?:/i,
  /data:/i,
  /url\((?!['"]?#)/i,
  /&#/i,
  /<img/i,
  /image-set|image\(|src\(/i,
  /\/\//,
];

describe('sanitizeSvg (NFR-SEC-001)', () => {
  it('NFR-SEC-001: pasted SVG loses its scripts and event handlers', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
    for (const [name, text] of CORPUS) {
      const clean = sanitizeSvg(text);
      // every hostile file is still an SVG, with nothing that runs, loads or links
      expect(clean, name).toBeDefined();
      // (the namespace the output declares is the one URL it may hold)
      // only markup can run or load, so the patterns are matched against the tags: a label may say what it likes, escaped
      const bare = ((clean ?? '').match(/<[^>]*>/g) ?? []).join('').replace('xmlns="http://www.w3.org/2000/svg"', '');
      for (const pattern of FORBIDDEN) expect(bare, `${name}: ${pattern}`).not.toMatch(pattern);
      // and sanitising what came out changes nothing: the output is a fixed point
      expect(sanitizeSvg(clean as string), name).toBe(clean);
    }
    const script = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" onclick="x()"/></svg>',
    );
    expect(script).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></rect></svg>');
  });

  it('NFR-SEC-001: what the allowlist names survives: shapes, text, gradients, ids and safe styles', () => {
    const svg = `<?xml version="1.0"?><!-- c --><svg viewBox="0 0 100 50" width="100" height="50" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
      <g transform="translate(5 5)"><rect x="1" y="2" width="30" height="20" rx="3" fill="url(#g)" stroke="#333" stroke-width="2" style="opacity:.5; stroke-dasharray: 4 2; color:red; fill: url(#g)"/>
      <circle cx="50" cy="25" r="10" fill="rgb(1, 2, 3)"/><path d="M0 0L10 10Z"/><use xlink:href="#g"/></g>
      <text x="1" y="40" font-family="Arial" font-size="12">A &amp; B &lt;ok&gt;</text></svg>`;
    const clean = sanitizeSvg(svg) as string;
    expect(clean.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">')).toBe(true);
    for (const kept of [
      '<linearGradient id="g"',
      '<stop offset="0" stop-color="#f00">',
      '<g transform="translate(5 5)">',
      'rx="3"',
      'fill="url(#amp;g)"'.replace('#amp;', '#'),
      '<circle cx="50" cy="25" r="10" fill="rgb(1, 2, 3)">',
      '<path d="M0 0L10 10Z">',
      '<use href="#g">',
      'A &amp; B &lt;ok&gt;',
    ])
      expect(clean, kept).toContain(kept);
    // a style keeps the properties on the list with safe values, and not `color`
    expect(clean).toContain('style="opacity:.5;stroke-dasharray:4 2;fill:url(#g)"');
    expect(clean).not.toContain('<!--');
    expect(clean).not.toContain('<?xml');
  });

  it('NFR-SEC-001: a reference names an id of the same file only, and a value is safe or gone', () => {
    const attr = (markup: string) => sanitizeSvg(`<svg>${markup}</svg>`) as string;
    expect(attr('<use href="#a"/>')).toContain('<use href="#a">');
    expect(attr('<use xlink:href="#a"/>')).toContain('<use href="#a">');
    for (const bad of ['a', 'https://x/y#a', '//x/y#a', 'javascript:alert(1)', '#', '# a', 'data:image/svg+xml,x', '#a b'])
      expect(attr(`<use href="${bad}"/>`), bad).not.toContain('href');
    // `href` and `xlink:href` are one attribute once written: the first good one stays, never two
    expect(attr('<use href="#a" xlink:href="#b"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"></use></svg>');
    expect(attr('<use href="https://x/y" xlink:href="#b"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"><use href="#b"></use></svg>');
    // CSS functions that load or leak are gone from a value and from a style; colours and transforms stay
    for (const bad of ["image-set('x.png' 1x)", "image('a')", 'src(x)', 'var(--x)', 'calc(1px+2px)', '//evil.example/x'])
      expect(attr(`<rect fill="${bad}" mask="${bad}" style="mask:${bad};fill:${bad}"/>`), bad).toBe(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect></rect></svg>',
      );
    expect(attr('<rect fill="hsl(10, 50%, 50%)" transform="rotate(45) translate(1 2) matrix(1 0 0 1 0 0)"/>')).toContain('fill="hsl(10, 50%, 50%)"');
    // a handler beside a good reference is gone, the reference stays
    expect(attr('<use href="#a" onload="x"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"></use></svg>');
    // paint servers and clips by id; anything else with url() is dropped
    expect(attr('<rect fill="url(#g)" clip-path="url(&quot;#c&quot;)"/>')).toContain('fill="url(#g)"');
    expect(attr('<rect fill="url(#g)" clip-path="url(&quot;#c&quot;)"/>')).toContain('clip-path="url(&quot;#c&quot;)"');
    for (const bad of [
      'url(https://x/y)',
      'url( http://x )',
      'URL(//x/y)',
      'url(data:text/html,x)',
      'expression(alert(1))',
      '\\6a avascript:x',
      'red/*x*/',
      'a<b',
    ])
      expect(attr(`<rect fill="${bad}"/>`), bad).not.toContain('fill=');
    // an attribute off the list, and one named like an event, are gone whatever their value
    expect(attr('<rect width="1" onmouseover="x" data-x="1" xml:space="preserve" id="r" class="c"/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" id="r" class="c"></rect></svg>',
    );
  });

  it('NFR-SEC-001: text is escaped, only text elements keep text, and entities are decoded then dropped or re-escaped', () => {
    const out = (markup: string) => sanitizeSvg(`<svg>${markup}</svg>`) as string;
    expect(out('<text>a&#60;b&#x3e;&amp;&bogus;&#0;&#xD800;c</text>')).toContain('<text>a&lt;b&gt;&amp;c</text>');
    expect(out('loose<rect/>text')).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect></rect></svg>');
    expect(out('<title>t &lt;b&gt;</title><desc>d</desc>')).toContain('<title>t &lt;b&gt;</title><desc>d</desc>');
    // CDATA is text, escaped
    expect(out('<text><![CDATA[<b>x</b>]]></text>')).toContain('<text>&lt;b&gt;x&lt;/b&gt;</text>');
    // an unterminated CDATA, comment, tag or doctype is read to the end and does not run on
    for (const open of [
      '<text><![CDATA[x',
      '<!-- never closed <script>alert(1)</script>',
      '<rect width="1" <script>alert(1)</script>',
      '<!DOCTYPE svg [ <!ENTITY a "b">',
    ])
      expect(sanitizeSvg(`<svg>${open}`) ?? '', open).not.toMatch(/<script|alert/);
  });

  it('NFR-SEC-001: only an svg root is a file; the unknown is dropped with what is inside it; size and depth are capped', () => {
    expect(sanitizeSvg('')).toBeUndefined();
    expect(sanitizeSvg('<html><body>hi</body></html>')).toBeUndefined();
    expect(sanitizeSvg('not xml')).toBeUndefined();
    expect(sanitizeSvg('<svg/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sanitizeSvg('<html><svg><rect/></svg></html>')).toBeUndefined();
    expect(sanitizeSvg('<svg><unknown><rect id="inside"/></unknown><rect id="after"/></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="after"></rect></svg>',
    );
    // the file's own namespace declarations are not kept; the root's is ours
    expect(sanitizeSvg('<svg xmlns="http://evil.example/ns" xmlns:svg="http://www.w3.org/2000/svg"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sanitizeSvg(`<svg>${' '.repeat(MAX_SVG_CHARS)}</svg>`)).toBeUndefined();
    const deep = sanitizeSvg(`<svg>${'<g>'.repeat(5000)}<rect/>${'</g>'.repeat(5000)}</svg>`) as string;
    expect((deep.match(/<g>/g) ?? []).length).toBeLessThanOrEqual(64);
    const many = sanitizeSvg(`<svg>${'<rect/>'.repeat(30_000)}</svg>`) as string;
    expect((many.match(/<rect>/g) ?? []).length).toBeLessThanOrEqual(20_001);
  });
});
