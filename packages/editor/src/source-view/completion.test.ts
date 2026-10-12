import { describe, expect, it } from 'vitest';
import { completionsAt, usedPacks } from './completion.js';
import { BASIC_IDS, catalog } from './completion-fixture.js';
import { siteAt } from './completion-site.js';

/** Completions at the `|` in `src` (the bar is removed). */
function at(src: string, cat = catalog()) {
  const pos = src.indexOf('|');
  const text = src.slice(0, pos) + src.slice(pos + 1);
  const r = completionsAt(text, pos, cat);
  return r === null ? null : { ...r, text, word: text.slice(r.from, pos), labels: r.options.map((o) => o.label) };
}
const SCREEN = 'flux: 1\nscreens:\n  - id: s\n';
const NODES = `${SCREEN}    nodes:\n      api:\n`;

describe('completionsAt (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: after shape: every registered shape id is offered, and a partial id is the word replaced', () => {
    const r = at(`${NODES}        shape: |`);
    expect(r?.labels).toEqual(expect.arrayContaining([...BASIC_IDS, 'flowchart:decision']));
    expect(r?.word).toBe('');
    expect(at(`${NODES}        shape: basic:re|`)?.word).toBe('basic:re');
    expect(at(`${NODES}        component: |`)?.labels).toContain('basic:rect');
  });

  it('FR-DSL-009: a pack the file uses is offered by short name too, boosted over the ones it does not use', () => {
    const r = at('flux: 1\nuses: [basic]\nscreens:\n  - id: s\n    nodes:\n      a:\n        shape: |');
    expect(r?.labels).toContain('rect');
    expect(r?.labels).not.toContain('decision');
    const boost = (l: string) => r?.options.find((o) => o.label === l)?.boost ?? 0;
    expect(boost('basic:rect')).toBeGreaterThan(boost('flowchart:decision'));
    expect(r?.options.find((o) => o.label === 'rect')?.detail).toBe('basic');
    expect(usedPacks('uses:\n  - basic\n  - "flowchart"\nscreens: []')).toEqual(['basic', 'flowchart']);
    expect(usedPacks('uses: [ a, b ]\n')).toEqual(['a', 'b']);
  });

  it('FR-DSL-009: token names are offered in style values, flow style and background', () => {
    expect(at(`${NODES}        style:\n          fill: |`)?.labels).toEqual(['color.brand.primary', 'color.text.primary', 'color.text.muted', 'space.4']);
    expect(at(`${NODES}        style:\n          stroke: color.te|`)?.word).toBe('color.te');
    expect(at(`${NODES}        style: { fill: color.b|`)?.labels).toContain('color.brand.primary');
    expect(at(`${NODES}        style: { fill: color.brand.primary, stroke: |`)?.labels).toContain('space.4');
    expect(at(`${SCREEN}    background: |`)?.labels).toContain('color.text.muted');
    expect(at(`${NODES}        text: |`)).toBeNull();
  });

  it('FR-DSL-009: slugs follow an edge op, start an edge line, and anchors follow a dot', () => {
    const E = `${SCREEN}    edges:\n      - `;
    expect(at(`${E}api -> |`)?.labels).toEqual(['api', 'db', 'cache']);
    expect(at(`${E}api -> d|`)?.word).toBe('d');
    expect(at(`${E}|`)?.labels).toEqual(expect.arrayContaining(['api', 'db', 'cache', 'from', 'to']));
    expect(at(`${E}api.|`)?.labels).toEqual(['n', 'e', 's', 'w']);
    expect(at(`${E}api.|`)?.word).toBe('');
    expect(at(`${E}api -> db.e|`)?.word).toBe('e');
    expect(at(`${E}api -> db: x\n      - a.|`)?.labels).toEqual(['n', 'e', 's', 'w']);
    expect(at(`${E}api -> db -> |`)).toBeNull();
  });

  it('FR-DSL-009: an edge op follows the first slug', () => {
    const r = at(`${SCREEN}    edges:\n      - api |`);
    expect(r?.labels).toEqual(['->', '<-', '<->', '--', '~>']);
    expect(at(`${SCREEN}    edges:\n      - api ~|`)?.word).toBe('~');
    expect(at(`${SCREEN}    edges:\n      - api.e |`)?.labels).toContain('<->');
  });

  it('FR-DSL-009: slugs complete in contains lists, block or flow, and in the from and to of an edge object', () => {
    const G = `${SCREEN}    groups:\n      g:\n        contains: `;
    expect(at(`${G}[|`)?.labels).toEqual(['api', 'db', 'cache']);
    expect(at(`${G}[api, d|`)?.word).toBe('d');
    expect(at(`${G.trimEnd()}\n          - |`)?.labels).toContain('cache');
    const E = `${SCREEN}    edges:\n      - from: `;
    expect(at(`${E}|`)?.labels).toContain('db');
    expect(at(`${E}api.|`)?.labels).toEqual(['n', 'e', 's', 'w']);
    expect(at(`${SCREEN}    edges:\n      - { from: api, to: |`)?.labels).toContain('db');
    expect(at(`${SCREEN}    edges:\n      - { from: a, op: |`)).toBeNull();
  });

  it('FR-DSL-009: packs complete in uses, flow or block', () => {
    expect(at('flux: 1\nuses: [|')?.labels).toEqual(['basic', 'flowchart']);
    expect(at('flux: 1\nuses:\n  - fl|')?.word).toBe('fl');
  });

  it('FR-DSL-009: keys come from the key table of the level, compiled first and deferred ones boosted lower', () => {
    const top = at('|');
    expect(top?.labels).toEqual(expect.arrayContaining(['flux', 'title', 'theme', 'uses', 'screens', 'vars', 'settings']));
    const boost = (r: typeof top, l: string) => r?.options.find((o) => o.label === l)?.boost ?? 0;
    expect(boost(top, 'screens')).toBeGreaterThan(boost(top, 'vars'));
    expect(top?.options.find((o) => o.label === 'vars')?.type).toBe('keyword');
    expect(top?.options.find((o) => o.label === 'screens')?.type).toBe('property');
    const screen = at(`${SCREEN.trimEnd()}\n    |`);
    expect(screen?.labels).toEqual(expect.arrayContaining(['title', 'layout', 'nodes', 'groups', 'edges', 'notes', 'steps']));
    expect(screen?.labels).not.toContain('shape');
    expect(at(`${SCREEN}    nodes:\n      api:\n        sh|`)?.labels).toEqual(expect.arrayContaining(['shape', 'text', 'style', 'pin', 'component']));
    expect(at(`${NODES}        pin:\n          |`)?.labels).toEqual(['x', 'y', 'w', 'h']);
    expect(at('theme:\n  |')?.labels).toEqual(expect.arrayContaining(['preset', 'overrides', 'accent']));
    expect(at(`${SCREEN}    groups:\n      g:\n        |`)?.labels).toEqual(expect.arrayContaining(['label', 'contains']));
    expect(at(`${SCREEN}    edges:\n      - api -> db:\n          |`)?.labels).toEqual(expect.arrayContaining(['label', 'route', 'flow']));
    expect(at(`${SCREEN}- |`)?.labels).toContain('edges');
    expect(at(`${SCREEN.replace('  - id: s\n', '  - |')}`)?.labels).toContain('id');
    expect(at(`${NODES}        style:\n          |`)).toBeNull();
    expect(at(`${SCREEN}    nodes:\n      |`)).toBeNull();
  });

  it('FR-DSL-009: nothing is offered in comments, quoted strings and block scalars', () => {
    expect(at(`${NODES}        shape: # |`)).toBeNull();
    expect(at(`${NODES}        shape: "basic:|`)).toBeNull();
    expect(at(`${NODES}        text: 'a -> |`)).toBeNull();
    expect(at(`${SCREEN}    notes: |\n      shape: |`)).toBeNull();
    expect(at(`${SCREEN}    edges:\n      - api -> db # to |`)).toBeNull();
    expect(at(`${NODES}        shape:|`)).toBeNull();
    expect(at('# shape: |')).toBeNull();
  });

  it('FR-DSL-009: a document mid-edit, invalid or truncated, still completes', () => {
    expect(at('flux: 1\nscreens:\n  - id: s\n    nodes:\n      a: [\n      b:\n        shape: |')?.labels).toContain('basic:rect');
    expect(at('flux: 1\n  garbage ::: \nscreens:\n  - id: s\n    edges:\n      - a -> |')?.labels).toContain('api');
    expect(at(`${NODES}        shape: |\n        text: "unterminated`)?.labels).toContain('basic:rect');
  });

  it('FR-DSL-009: an empty list is no completion', () => {
    expect(at(`${NODES}        shape: |`, catalog({ shapes: () => [] }))).toBeNull();
    expect(at(`${SCREEN}    edges:\n      - api -> |`, catalog({ slugs: () => [] }))).toBeNull();
  });

  it('FR-DSL-009: a nested flow map offers token names where the block form does', () => {
    const E = `${SCREEN}    edges:\n      - `;
    expect(at(`${E}a -> b: { style: { fill: |`)?.labels).toContain('color.brand.primary');
    expect(at(`${E}a -> b: { style: { fill: color.t|`)?.word).toBe('color.t');
    expect(at(`${E}{ style: { fill: |`)?.labels).toContain('space.4');
    expect(at(`${E}a -> b: { label: x, style: { fill: |`)?.labels).toContain('space.4');
    expect(at(`${E}a -> b: { style: { fill: red }, label: |`)).toBeNull();
    expect(at(`${NODES.replace('api:\n', 'api: { style: { stroke: |')}`)?.labels).toContain('space.4');
  });

  it('FR-DSL-009: shape and component are shape ids at node level only, and a node named style is not a style', () => {
    expect(at(`${SCREEN}    edges:\n      - { shape: |`)).toBeNull();
    expect(at(`${SCREEN}    edges:\n      - from: a\n        shape: |`)).toBeNull();
    expect(at(`${SCREEN}    shape: |`)).toBeNull();
    expect(at(`${SCREEN}    groups:\n      g:\n        component: |`)).toBeNull();
    expect(at(`${SCREEN}    nodes:\n      api: { shape: |`)?.labels).toContain('basic:rect');
    const named = `${SCREEN}    nodes:\n      style:\n`;
    expect(at(`${named}        text: |`)).toBeNull();
    expect(at(`${named}        shape: |`)?.labels).toContain('basic:rect');
    expect(at(`${named}        style:\n          fill: |`)?.labels).toContain('space.4');
    expect(at(`${SCREEN}    nodes:\n      style: { text: |`)).toBeNull();
  });

  it('FR-DSL-009: a long run of whitespace between two open flow brackets is read in linear time', () => {
    // the owner of a bracket was read with a backtracking regex: `api: {` + 2,000 spaces + `x {` took 6.7 s and 5,000 did not finish
    const head = 'flux: 1\nscreens:\n  - id: s\n    edges:\n';
    const text = `${head}      - a -> b: {${' '.repeat(2000)}x { fill: `;
    const started = performance.now();
    siteAt(text, text.length);
    expect(performance.now() - started).toBeLessThan(1000);
    // a long run of whitespace after a key still finds the nested site
    const spaced = `${head}      - a -> b: { style:${' '.repeat(2000)}{ fill: `;
    expect(siteAt(spaced, spaced.length)?.kind).toBe('token');
  });

  it('FR-DSL-009: a 50,000-character line is scanned back from the cursor in linear time, whatever its shape', () => {
    // the word before the cursor was found with `/[\w.:-]*$/`, `/^(.*?)(\S*)$/s` and `/[\w-]*$/`: each took about 2.5 s on 'a' x 50,000 + '!'
    const long = 'a'.repeat(50_000);
    const E = `${SCREEN}    edges:\n      - `;
    const N = `${SCREEN}    nodes:\n      api:\n        `;
    const shapes: readonly string[] = [
      `${E}${long}!`,
      `${E}${long} `,
      `${E}x -> ${long}!`,
      `${E}${long} -> `,
      `${N}${long}!`,
      `${N}${long} `,
      `${N}shape: ${long}!`,
      `${N}shape: ${long} `,
      `${N}style: { fill: ${long}!`,
      `${N}style: { fill: ${long} `,
      `${SCREEN}    groups:\n      g:\n        contains: [${long}!`,
      `${SCREEN}    groups:\n      g:\n        contains: [${long} `,
      `flux: 1\nuses:\n  - ${long}!`,
      `${E}{ ${long}!`,
    ];
    for (const text of shapes) {
      const started = performance.now();
      siteAt(text, text.length);
      completionsAt(text, text.length, catalog());
      expect(performance.now() - started, text.slice(0, 60)).toBeLessThan(1000);
    }
    // the sites themselves are unchanged: the word is what the cursor is after, back to its start
    expect(siteAt(`${E}${long}`, `${E}${long}`.length)).toEqual({ kind: 'edge-start', from: E.length });
    expect(siteAt(`${E}x -> ${long}`, `${E}x -> ${long}`.length)).toEqual({ kind: 'slug', from: E.length + 5 });
    expect(siteAt(`${N}${long}`, `${N}${long}`.length)).toEqual({ kind: 'key', level: 'node', from: N.length });
  });
});
