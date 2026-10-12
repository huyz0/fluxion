import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FluxScriptToken, fluxScriptTokens } from './fluxscript-tokens.js';

const example = (name: string) => readFileSync(new URL(`../../../../examples/dsl/${name}`, import.meta.url), 'utf8');
/** `class:text` of each token, in document order. */
const spans = (src: string, tokens: readonly FluxScriptToken[]) => tokens.map((t) => `${t.class}:${src.slice(t.from, t.to)}`);
const only = (src: string, cls: FluxScriptToken['class']) =>
  spans(
    src,
    fluxScriptTokens(src).filter((t) => t.class === cls),
  );

describe('fluxScriptTokens, the FluxScript layer over the Lezer YAML tree (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: edge ops, slugs and anchors of the shorthand come from the compiler tokenizer', () => {
    const src = 'screens:\n  - id: s\n    edges:\n      - hub.n -> north.s: { route: straight }\n      - a <-> b\n      - c ~> d: queued\n';
    expect(spans(src, fluxScriptTokens(src)).filter((s) => /^fx-(op|slug|anchor):/.test(s))).toEqual([
      'fx-slug:hub',
      'fx-anchor:n',
      'fx-op:->',
      'fx-slug:north',
      'fx-anchor:s',
      'fx-slug:a',
      'fx-op:<->',
      'fx-slug:b',
      'fx-slug:c',
      'fx-op:~>',
      'fx-slug:d',
    ]);
  });

  it('FR-DSL-009: the five ops of edge-ops.flux.yaml are marked, in the shorthand and in the object form', () => {
    const src = example('edge-ops.flux.yaml');
    const ops = only(src, 'fx-op');
    for (const op of ['->', '<-', '<->', '--', '~>']) expect(ops, op).toContain(`fx-op:${op}`);
    // 6 + 6 shorthand edges and 4 object-form ones
    expect(ops).toHaveLength(16);
    expect(only(src, 'fx-anchor')).toEqual(expect.arrayContaining(['fx-anchor:n', 'fx-anchor:e', 'fx-anchor:s', 'fx-anchor:w']));
  });

  it('FR-DSL-009: an edge the compiler tokenizer refuses is left unmarked', () => {
    const src = 'screens:\n  - id: s\n    edges:\n      - a => b\n      - Web -> api\n      - a -> b -> c\n';
    expect(spans(src, fluxScriptTokens(src)).filter((s) => /^fx-(op|slug|anchor):/.test(s))).toEqual([]);
  });

  it('FR-DSL-009: keys are marked by level: compiled keys, deferred keys, and nothing for a name the table lacks', () => {
    const src = 'flux: 1\nvars: {}\nbogus: 1\nscreens:\n  - id: s\n    kind: title\n    nodes:\n      label: { shape: rect, label: L, icon: x }\n';
    expect(spans(src, fluxScriptTokens(src)).filter((s) => s.startsWith('fx-key'))).toEqual([
      'fx-key:flux',
      'fx-key-deferred:vars',
      'fx-key:screens',
      'fx-key:id',
      'fx-key-deferred:kind',
      'fx-key:nodes',
      'fx-key:shape',
      'fx-key:label',
      'fx-key-deferred:icon',
    ]);
  });

  it('FR-DSL-009: shape ids are split into pack and shape, and uses names the packs', () => {
    const checkout = example('checkout.flux.yaml');
    expect(only(checkout, 'fx-pack')).toEqual(['fx-pack:basic', 'fx-pack:basic', 'fx-pack:effects-core']);
    expect(only(checkout, 'fx-shape')).toEqual(expect.arrayContaining(['fx-shape:rounded-rect', 'fx-shape:cylinder', 'fx-shape:stat', 'fx-shape:dot']));
    const block = 'uses:\n  - basic\n  - "flow"\nscreens: []\n';
    expect(only(block, 'fx-pack')).toEqual(['fx-pack:basic', 'fx-pack:flow']);
  });

  it('FR-DSL-009: checkout.flux.yaml marks its five edges and no range overlaps another', () => {
    const src = example('checkout.flux.yaml');
    const tokens = fluxScriptTokens(src);
    expect(only(src, 'fx-op')).toEqual(['fx-op:->', 'fx-op:->', 'fx-op:->', 'fx-op:~>']);
    tokens.forEach((t, i) => {
      expect(t.to).toBeGreaterThan(t.from);
      if (i > 0) expect(t.from).toBeGreaterThanOrEqual(tokens[i - 1]?.to ?? 0);
    });
  });

  it('FR-DSL-009: object-form ends are marked at their position inside the flow mapping', () => {
    const src = 'screens:\n  - id: s\n    edges:\n      - { from: producer.e, to: broker, op: "~>" }\n';
    expect(spans(src, fluxScriptTokens(src)).filter((s) => /^fx-(op|slug|anchor):/.test(s))).toEqual([
      'fx-slug:producer',
      'fx-anchor:e',
      'fx-slug:broker',
      'fx-op:~>',
    ]);
  });

  it('FR-DSL-009: a document that is not a mapping, or is empty, has no tokens', () => {
    expect(fluxScriptTokens('')).toEqual([]);
    expect(fluxScriptTokens('- a\n- b\n')).toEqual([]);
  });
});
