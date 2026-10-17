import { createCoreRegistries } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { CORE_LINT_RULES, lint, registerLintRules } from './lint.js';
import type { LintContext, LintReport } from './types.js';

type El = { readonly [field: string]: unknown };
const screen = { id: 's1', type: 'screen', index: 'a0', size: { w: 1000, h: 600 } };
const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h, rot: 0 });
const text = (words: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] });
const el = (id: string, fields: El): El => ({
  id,
  type: 'element',
  screenId: 's1',
  index: 'a0',
  kind: 'shape',
  defId: 'basic:rect',
  transform: box(10, 10),
  ...fields,
});
const docOf = (...els: El[]): DocumentFile => ({ records: Object.fromEntries([screen, ...els].map((r) => [r['id'], r])) }) as unknown as DocumentFile;
const registry = () => {
  const r = createCoreRegistries();
  registerLintRules(r.lintRules);
  return r.lintRules;
};
const run = (doc: DocumentFile, ctx: LintContext = {}): LintReport => lint(doc, registry(), ctx);
const only = (report: LintReport, id: string) => report.findings.filter((f) => f.code === `FLX_LINT_${id}`);
const MEASURE: LintContext = {
  measureText: (t, font) => ({ w: t.length * font.size * 0.5, h: font.size * 1.2 * Math.ceil((t.length * font.size * 0.5) / 100) }),
};
const THEMED: LintContext = { theme: LIGHT_THEME };

describe('the quality linter (FR-AI-005)', () => {
  it('FR-AI-005: the core registry holds the ten rules, each with a description and a weight', () => {
    expect(CORE_LINT_RULES.map((r) => r.id)).toEqual([
      'OVERLAP',
      'OFFSCREEN',
      'TEXT_OVERFLOW',
      'DENSITY',
      'ORPHAN_CONNECTOR',
      'CONTRAST',
      'STYLE_LITERAL',
      'STYLE_INCONSISTENT',
      'ALT_MISSING',
      'READING_ORDER',
    ]);
    for (const r of CORE_LINT_RULES) {
      expect(r.describe.length, r.id).toBeGreaterThan(10);
      expect(r.weight, r.id).toBeGreaterThan(0);
    }
    expect(
      registry()
        .list()
        .map(([key]) => key),
    ).toHaveLength(10);
  });

  it('FR-AI-005: OVERLAP reports two boxes covering each other, not apart ones nor a child in its group', () => {
    expect(only(run(docOf(el('a', {}), el('b', { transform: box(30, 20) }))), 'OVERLAP')).toHaveLength(1);
    expect(only(run(docOf(el('a', {}), el('b', { transform: box(300, 300) }))), 'OVERLAP')).toHaveLength(0);
    const grouped = docOf(
      el('g', { kind: 'group', transform: box(0, 0, 400, 400) }),
      el('a', { parentId: 'g' }),
      el('b', { parentId: 'g', transform: box(300, 300) }),
    );
    expect(only(run(grouped), 'OVERLAP')).toHaveLength(0);
  });

  it('FR-AI-005: OFFSCREEN reports an element past the screen edge, not one inside it', () => {
    expect(only(run(docOf(el('a', { transform: box(950, 10) }))), 'OFFSCREEN').map((f) => f.elements)).toEqual([['a']]);
    expect(only(run(docOf(el('a', { transform: box(900, 550) }))), 'OFFSCREEN')).toHaveLength(0);
  });

  it('FR-AI-005: TEXT_OVERFLOW reports measured text taller than its box, and nothing without a measurer', () => {
    const long = el('a', { kind: 'text', text: text('a very long line of words that wraps over many lines in a narrow box') });
    expect(only(run(docOf(long), MEASURE), 'TEXT_OVERFLOW')).toHaveLength(1);
    expect(only(run(docOf(el('a', { kind: 'text', text: text('ok') })), MEASURE), 'TEXT_OVERFLOW')).toHaveLength(0);
    expect(only(run(docOf(long)), 'TEXT_OVERFLOW')).toHaveLength(0);
  });

  it('FR-AI-005: CONTRAST reports pale text on a pale fill, not dark text on a light one, and nothing without a theme', () => {
    const style = (color: string, fill: string) => ({ fill, font: { color, size: 16 } });
    const pale = el('a', { text: text('hello'), style: style('#888888', '#999999') });
    const dark = el('a', { text: text('hello'), style: style('#000000', '#ffffff') });
    expect(only(run(docOf(pale), THEMED), 'CONTRAST')).toHaveLength(1);
    expect(only(run(docOf(dark), THEMED), 'CONTRAST')).toHaveLength(0);
    expect(only(run(docOf(pale)), 'CONTRAST')).toHaveLength(0);
  });

  it('FR-AI-005: DENSITY reports a screen with too many words, not a sparse one', () => {
    const wordy = el('a', { kind: 'text', text: text(Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ')) });
    expect(only(run(docOf(wordy)), 'DENSITY')).toHaveLength(1);
    expect(only(run(docOf(el('a', { text: text('three small words') }))), 'DENSITY')).toHaveLength(0);
  });

  it('FR-AI-005: ORPHAN_CONNECTOR reports a connector with no binding, not a bound one', () => {
    const connector = { id: 'c', type: 'element', screenId: 's1', index: 'a0', kind: 'connector' };
    const bound = { id: 'b1', type: 'binding', connectorId: 'c', end: 'source', elementId: 'a' };
    expect(only(run(docOf(el('a', {}), connector)), 'ORPHAN_CONNECTOR')).toHaveLength(1);
    expect(only(run(docOf(el('a', {}), connector, bound)), 'ORPHAN_CONNECTOR')).toHaveLength(0);
  });

  it('FR-AI-005: STYLE_LITERAL reports a colour literal, not a token reference', () => {
    expect(only(run(docOf(el('a', { style: { fill: '#336699' } }))), 'STYLE_LITERAL')).toHaveLength(1);
    expect(only(run(docOf(el('a', { style: { fill: '{color.primary}' } }))), 'STYLE_LITERAL')).toHaveLength(0);
  });

  it('FR-AI-005: STYLE_INCONSISTENT reports five font sizes on one screen, not three', () => {
    const sized = (sizes: number[]) => docOf(...sizes.map((size, i) => el(`e${i}`, { transform: box(10 + i * 150, 10), style: { font: { size } } })));
    expect(only(run(sized([10, 12, 14, 16, 18])), 'STYLE_INCONSISTENT')).toHaveLength(1);
    expect(only(run(sized([12, 16, 24])), 'STYLE_INCONSISTENT')).toHaveLength(0);
  });

  it('NFR-A11Y-006: ALT_MISSING reports an unnamed image, icon or role-bearing group, not a named one nor a plain shape or group', () => {
    const image = (id: string, fields: El = {}) => el(id, { kind: 'image', ...fields });
    expect(only(run(docOf(image('a'), el('b', { kind: 'icon' }))), 'ALT_MISSING').map((f) => f.elements)).toEqual([['a'], ['b']]);
    expect(only(run(docOf(image('a', { semantic: { label: 'Orders database' } }))), 'ALT_MISSING')).toHaveLength(0);
    expect(only(run(docOf(image('a', { semantic: { label: '   ' } }))), 'ALT_MISSING')).toHaveLength(1);
    expect(only(run(docOf(el('g', { kind: 'group', semantic: { role: 'service' } }))), 'ALT_MISSING')).toHaveLength(1);
    expect(only(run(docOf(el('g', { kind: 'group', semantic: { role: 'service', label: 'Billing' } }))), 'ALT_MISSING')).toHaveLength(0);
    expect(only(run(docOf(el('g', { kind: 'group' }), el('s', {}))), 'ALT_MISSING')).toHaveLength(0);
  });

  it('NFR-A11Y-006: READING_ORDER reports a screen written bottom to top, not one written top to bottom, nor a short one', () => {
    const column = (order: readonly string[]) =>
      docOf(...order.map((id, n) => el(id, { index: `a${n}`, transform: box(10, { a: 10, b: 100, c: 200, d: 300 }[id] ?? 0) })));
    const upside = only(run(column(['d', 'c', 'b', 'a'])), 'READING_ORDER');
    expect(upside).toHaveLength(1);
    expect(upside[0]?.elements).toEqual(['s1']);
    expect(only(run(column(['a', 'b', 'c', 'd'])), 'READING_ORDER')).toHaveLength(0);
    expect(only(run(column(['c', 'b'])), 'READING_ORDER')).toHaveLength(0);
    // a row read left to right is in order, and the same row written right to left is not
    const row = (xs: readonly number[]) => docOf(...xs.map((x, n) => el(`e${n}`, { index: `a${n}`, transform: box(x, 10) })));
    expect(only(run(row([10, 200, 400])), 'READING_ORDER')).toHaveLength(0);
    expect(only(run(row([400, 200, 10])), 'READING_ORDER')).toHaveLength(1);
  });

  it('FR-AI-005: the score is 100 minus the weights of the findings, never below 0, and a clean document scores 100', () => {
    expect(run(docOf(el('a', {}))).score).toBe(100);
    const off = run(docOf(el('a', { transform: box(950, 10) })));
    expect(off.score).toBe(100 - (CORE_LINT_RULES.find((r) => r.id === 'OFFSCREEN')?.weight ?? 0));
    const many = docOf(...Array.from({ length: 40 }, (_, i) => el(`e${i}`, { transform: box(2000 + i, 10) })));
    expect(run(many).score).toBe(0);
  });

  it('FR-AI-005: the findings are the same for the same document', () => {
    const doc = docOf(el('a', {}), el('b', { transform: box(30, 20) }), el('c', { transform: box(990, 10), style: { fill: '#112233' } }));
    expect(run(doc, THEMED)).toEqual(run(doc, THEMED));
  });
});
