import { readdirSync, readFileSync } from 'node:fs';
import { yamlLanguage } from '@codemirror/lang-yaml';
import { EDGE_OPS, fluxScriptKeys } from '@fluxion/dsl';
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import yaml from 'shiki/langs/yaml.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FluxScriptTokenClass, fluxScriptTokens } from './fluxscript-tokens.js';

// T0 for FR-DSL-009 (M12.20). The TextMate grammar (packages/dsl/grammar) is run by shiki's engine, with shiki's YAML grammar as `source.yaml`;
// the Lezer side is `@codemirror/lang-yaml` plus this chunk's layer. Both read every example of examples/dsl.
const EXAMPLES_DIR = new URL('../../../../examples/dsl/', import.meta.url);
const GRAMMAR_URL = new URL('../../../dsl/grammar/fluxscript.tmLanguage.json', import.meta.url);
const GOLDEN = '../../__golden__/checkout.flux.tokens.txt';
const examples = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith('.flux.yaml'))
  .sort()
  .map((name) => ({ name, text: readFileSync(new URL(name, EXAMPLES_DIR), 'utf8') }));
const grammarJson = JSON.parse(readFileSync(GRAMMAR_URL, 'utf8')) as {
  scopeName: string;
  patterns: unknown;
  repository: Record<string, { match: string }>;
};
const checkout = examples.find((e) => e.name === 'checkout.flux.yaml')?.text ?? '';

/** A token of the TextMate run: its absolute range, text and the FluxScript scopes it carries (meta scopes left out). */
type TmToken = { readonly from: number; readonly to: number; readonly line: number; readonly col: number; readonly text: string; readonly scopes: string[] };

let highlighter: HighlighterCore;
beforeAll(async () => {
  const theme = { name: 'plain', type: 'dark' as const, settings: [{ settings: { foreground: '#ffffff', background: '#000000' } }] };
  highlighter = await createHighlighterCore({
    langs: [yaml, { ...grammarJson, name: 'fluxscript' } as unknown as LanguageRegistration],
    themes: [theme],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
});

/** Tokenize `text` with the FluxScript grammar; only the tokens that carry a (non-meta) `.fluxscript` scope are returned. */
function tokenize(text: string): TmToken[] {
  const { tokens } = highlighter.codeToTokens(text, { lang: 'fluxscript', theme: 'plain', includeExplanation: 'scopeName' });
  const out: TmToken[] = [];
  let lineStart = 0;
  tokens.forEach((line, i) => {
    let offset = 0;
    for (const token of line) {
      for (const piece of token.explanation ?? []) {
        const scopes = piece.scopes.map((s) => s.scopeName).filter((s) => s.endsWith('.fluxscript') && !s.startsWith('meta.') && s !== 'source.fluxscript');
        const from = lineStart + offset;
        if (scopes.length > 0) out.push({ from, to: from + piece.content.length, line: i + 1, col: offset + 1, text: piece.content, scopes });
        offset += piece.content.length;
      }
    }
    lineStart += offset + 1;
  });
  return out;
}

const render = (tokens: readonly TmToken[]): string =>
  `${tokens.map((t) => `${t.line}:${t.col} ${JSON.stringify(t.text)} ${t.scopes.join(' ')}`).join('\n')}\n`;

describe('FluxScript TextMate grammar (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: the TextMate tokenization of checkout.flux.yaml matches its snapshot', async () => {
    const tokens = tokenize(checkout);
    expect(tokens.length).toBeGreaterThan(40);
    await expect(render(tokens)).toMatchFileSnapshot(GOLDEN);
  });

  it('FR-DSL-009: the TextMate snapshot is stable: two tokenizations of every example give the same tokens', () => {
    for (const { name, text } of examples) expect(render(tokenize(text)), name).toBe(render(tokenize(text)));
  });

  it('FR-DSL-009: the grammar names the same keys and the same five edge ops as the compiler', () => {
    const table = Object.values(fluxScriptKeys());
    const patterns = grammarJson.repository;
    const listed = (rule: string) => new Set((/\(\?<!\[\\w\.-\]\)\(([^)]*)\)/.exec(patterns[rule]?.match ?? '')?.[1] ?? '').split('|'));
    expect(listed('key-compiled')).toEqual(new Set(table.flatMap((l) => l.compiled)));
    expect(listed('key-deferred')).toEqual(new Set(table.flatMap((l) => l.deferred)));
    const ops = /\(<->\|[^)]*\)/.exec(patterns['edge-shorthand']?.match ?? '')?.[0] ?? '';
    expect(new Set(ops.slice(1, -1).split('|'))).toEqual(new Set(EDGE_OPS));
  });

  it('FR-DSL-009: every key has the same class (compiled or deferred) in the key table, the TextMate grammar and the Lezer layer', () => {
    // A minimal document per level puts `key: x` where the compiler reads that level. No name is compiled at one level and deferred at another
    // (the table forbids a key in both lists, and a name shared by levels, like label/style/layout, is compiled at each), so the grammar needs no
    // neutral class: this allowlist of names whose levels disagree must stay empty.
    const MIXED: readonly string[] = [];
    const wrap: Record<keyof ReturnType<typeof fluxScriptKeys>, (kv: string) => string> = {
      top: (kv) => `${kv}\n`,
      theme: (kv) => `theme:\n  ${kv}\n`,
      screen: (kv) => `screens:\n  - ${kv}\n`,
      node: (kv) => `screens:\n  - nodes:\n      n:\n        ${kv}\n`,
      group: (kv) => `screens:\n  - groups:\n      g:\n        ${kv}\n`,
      edge: (kv) => `screens:\n  - edges:\n      - ${kv}\n`,
      pin: (kv) => `screens:\n  - nodes:\n      n:\n        pin:\n          ${kv}\n`,
    };
    const tmClass = (doc: string, key: string): string | undefined => {
      const scope = tokenize(doc).find((t) => t.text === key && t.scopes.some((s) => s.startsWith('support.type.property-name')));
      if (!scope) return undefined;
      return scope.scopes.some((s) => s === 'support.type.property-name.deferred.fluxscript') ? 'deferred' : 'compiled';
    };
    const lezerClass = (doc: string, key: string): string | undefined => {
      const at = doc.indexOf(`${key}: x`);
      const t = fluxScriptTokens(doc).find((tok) => tok.from === at && tok.to === at + key.length);
      return t?.class === 'fx-key' ? 'compiled' : t?.class === 'fx-key-deferred' ? 'deferred' : undefined;
    };
    const classes = new Map<string, Set<string>>();
    let checked = 0;
    for (const [level, table] of Object.entries(fluxScriptKeys()) as [keyof typeof wrap, ReturnType<typeof fluxScriptKeys>['top']][]) {
      for (const [expected, keys] of [
        ['compiled', table.compiled],
        ['deferred', table.deferred],
      ] as const) {
        for (const key of keys) {
          const doc = wrap[level](`${key}: x`);
          expect(tmClass(doc, key), `grammar, ${level}.${key}`).toBe(expected);
          expect(lezerClass(doc, key), `Lezer, ${level}.${key}`).toBe(expected);
          classes.set(key, (classes.get(key) ?? new Set()).add(expected));
          checked++;
        }
      }
    }
    expect([...classes].filter(([, c]) => c.size > 1).map(([k]) => k)).toEqual([...MIXED]);
    expect(checked).toBeGreaterThan(50);
  });

  it('FR-DSL-009: the grammar file declares scope source.fluxscript and extends source.yaml', () => {
    expect(grammarJson.scopeName).toBe('source.fluxscript');
    expect(grammarJson.patterns).toEqual([{ include: 'source.yaml' }]);
  });

  it('FR-DSL-009: the TextMate grammar and the compiler tokenizer agree on every op, slug and anchor of every example', () => {
    const kind: Record<string, FluxScriptTokenClass | undefined> = {
      'keyword.operator.edge.fluxscript': 'fx-op',
      'variable.other.slug.fluxscript': 'fx-slug',
      'variable.other.anchor.fluxscript': 'fx-anchor',
    };
    let compared = 0;
    for (const { name, text } of examples) {
      const tm = tokenize(text).flatMap((t) => t.scopes.flatMap((s) => (kind[s] ? [`${t.from}-${t.to} ${kind[s]}`] : [])));
      const dsl = fluxScriptTokens(text)
        .filter((t) => t.class === 'fx-op' || t.class === 'fx-slug' || t.class === 'fx-anchor')
        .map((t) => `${t.from}-${t.to} ${t.class}`);
      expect(new Set(tm), name).toEqual(new Set(dsl));
      compared += dsl.length;
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe('FluxScript Lezer grammar (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: the Lezer YAML tree of every example has no error node', () => {
    expect(examples.length).toBe(10);
    for (const { name, text } of examples) {
      const errors: string[] = [];
      yamlLanguage.parser.parse(text).iterate({
        enter(n) {
          if (n.type.isError) errors.push(`${n.from}-${n.to}`);
        },
      });
      expect(errors, name).toEqual([]);
    }
  });
});
