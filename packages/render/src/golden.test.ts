import { describe, expect, it } from 'vitest';
import { normalizeSvg } from './golden.js';

describe('SVG normalizer (NFR-REL-005)', () => {
  it('NFR-REL-005: the normalizer keeps drawn SVG and element groups, sorted, rounded and with numbered ids', () => {
    const html = [
      '<section class="fx-screen" data-screen-id="S1"><div class="fx-layer fx-background" style="x"></div>',
      '<div class="fx-layer fx-content">',
      '<div class="fx-el" data-kind="shape" data-el-id="e9a1e5" style="left:10.004px;top:-0.001px"><svg viewBox="0 0 10 5" aria-hidden="true">',
      '<defs><linearGradient id="fx-fill-s0-_R_1_" y2="0.3333333" x1="1"><stop offset="0.5"/></linearGradient></defs>',
      '<path class="fx-outline" d="M0 0 L10.126 0" style="fill:url(#fx-fill-s0-_R_1_);stroke:#0f172a"></path></svg>',
      '<div class="fx-label" style="a"><p>Hello &amp; <b>bye</b></p></div><div class="fx-members"></div><div class="fx-placeholder" role="img" aria-label="Unsupported element: x:y" title="t"><span>x:y</span></div></div>',
      '<div class="fx-el" data-kind="connector" data-el-id="c1"><svg><defs><marker id="fx-marker-s0-_R_2_-end"></marker></defs>',
      '<path marker-end="url(#fx-marker-s0-_R_2_-end)"></path></svg></div>',
      '</div></section><section class="fx-screen" data-screen-id="S2"><div class="fx-layer fx-content"></div></section>',
    ].join('');
    expect(normalizeSvg(html)).toBe(
      [
        '<svg data-screen-id="S1" xmlns="http://www.w3.org/2000/svg">',
        '  <g data-el-id="e9a1e5" data-kind="shape" data-place="left:10px;top:0px">',
        '    <svg aria-hidden="true" viewBox="0 0 10 5">',
        '      <defs>',
        '        <linearGradient id="fx-id-0" x1="1" y2="0.33">',
        '          <stop offset="0.5"/>',
        '        </linearGradient>',
        '      </defs>',
        '      <path class="fx-outline" d="M0 0 L10.13 0" style="fill:url(#fx-id-0);stroke:#0f172a">',
        '      </path>',
        '    </svg>',
        '    <text class="fx-label">',
        '      Hello &amp;',
        '      bye',
        '    </text>',
        '    <g class="fx-members">',
        '    </g>',
        '    <g aria-label="Unsupported element: x:y" class="fx-placeholder" role="img">',
        '      x:y',
        '    </g>',
        '  </g>',
        '  <g data-el-id="c1" data-kind="connector">',
        '    <svg>',
        '      <defs>',
        '        <marker id="fx-id-1-end">',
        '        </marker>',
        '      </defs>',
        '      <path marker-end="url(#fx-id-1-end)">',
        '      </path>',
        '    </svg>',
        '  </g>',
        '</svg>',
        '<svg data-screen-id="S2" xmlns="http://www.w3.org/2000/svg">',
        '</svg>',
        '',
      ].join('\n'),
    );
  });

  it('NFR-REL-005: image masks and crops and stroke clips and masks get numbered ids too (M5.15 review)', () => {
    const html = [
      '<section class="fx-screen" data-screen-id="S1"><div class="fx-layer fx-content">',
      '<div class="fx-el" data-kind="image" data-el-id="i1"><svg><clipPath id="fx-mask-s0-_R_7_"></clipPath><g clip-path="url(#fx-mask-s0-_R_7_)"></g>',
      '<clipPath id="fx-crop-s0-_R_7_"></clipPath><clipPath id="fx-clip-s0-_R_8_"></clipPath><mask id="fx-edge-s0-_R_8_"></mask><filter id="fx-effects-s0-_R_9_"></filter></svg></div>',
      '</div></section>',
    ].join('');
    const svg = normalizeSvg(html);
    expect(svg).not.toMatch(/_R_/);
    for (const id of ['fx-id-0', 'fx-id-1', 'fx-id-2', 'fx-id-3', 'fx-id-4']) expect(svg).toContain(`id="${id}"`);
    expect(svg).toContain('url(#fx-id-0)');
  });
});

describe('SVG normalizer: connector labels (NFR-REL-005, FR-CON-006)', () => {
  it('NFR-REL-005: a connector label becomes text that keeps its placement', () => {
    const html = [
      '<section class="fx-screen" data-screen-id="S1"><div class="fx-layer fx-content">',
      '<div class="fx-el" data-kind="connector" data-el-id="c1"><svg class="fx-connector"><path class="fx-route" d="M0 0 L10 0"></path></svg>',
      '<div class="fx-connector-label" style="left:5.004px;top:-0.001px"><p>Yes</p></div></div>',
      '</div></section>',
    ].join('');
    expect(normalizeSvg(html)).toContain(['    <text class="fx-connector-label" data-place="left:5px;top:0px">', '      Yes', '    </text>'].join('\n'));
  });
});
