import { describe, expect, it } from 'vitest';
import { minifySvg } from './minify-svg.js';
import { sanitizeSvg } from './sanitize-svg.js';

describe('minifySvg', () => {
  it('FR-AST-002: comments and the whitespace between elements go, attributes and shown text stay', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <!-- a comment -->\n  <g>\n    <rect x="1" y="2" width="3" height="4"/>\n  </g>\n</svg>\n';
    expect(minifySvg(svg)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g><rect x="1" y="2" width="3" height="4"/></g></svg>');
  });

  it('FR-AST-002: whitespace inside text, tspan, title and desc is drawn, so it is kept', () => {
    const svg = '<svg>\n <text x="1">  a <tspan> b </tspan> c  </text>\n <title> T </title>\n</svg>';
    expect(minifySvg(svg)).toBe('<svg><text x="1">  a <tspan> b </tspan> c  </text><title> T </title></svg>');
    // text after the element has closed is between elements again
    expect(minifySvg('<svg><text>a</text>  <text/>  <g/></svg>')).toBe('<svg><text>a</text><text/><g/></svg>');
  });

  it('FR-AST-002: what it cannot read as tags is returned as it came', () => {
    for (const odd of ['<svg><!-- never closed', '<svg><rect', 'plain text']) expect(minifySvg(odd)).toBe(odd);
  });

  it('FR-AST-002: it is smaller than the sanitizer output and stays sanitized and the same drawing (a second pass changes nothing)', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <!-- hostile and tidy -->
      <script>alert(1)</script>
      <g fill="red">
        <circle cx="50" cy="50" r="40" onclick="x()"/>
        <text x="10" y="20">  hello  </text>
      </g>
    </svg>`;
    const clean = sanitizeSvg(raw) ?? '';
    const small = minifySvg(clean);
    expect(small.length).toBeLessThanOrEqual(clean.length);
    expect(small).not.toMatch(/script|onclick|<!--/);
    expect(small).toContain('<text');
    expect(small).toContain('  hello  ');
    expect(minifySvg(small)).toBe(small);
    expect(sanitizeSvg(small)).toBe(clean);
  });
});
