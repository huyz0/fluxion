import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { problemsOf } from './problems.js';

/** A document with a connector bound to two shapes, and the shapes' ids. */
function build() {
  const b = documentBuilder({ seed: 90 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 100, h: 50 });
  const c = b.rect(s, { x: 300, y: 0, w: 100, h: 50 });
  const line = b.connect(a, c);
  return { doc: b.build(), s, a, c, line };
}

/** `doc` without the record `id`, whatever refers to it left as it is (what no command can do). */
function without(doc: DocumentFile, id: string): DocumentFile {
  const { [id]: _gone, ...records } = doc.records;
  return { ...doc, records };
}

describe('the problems of a document (FR-EDT-021)', () => {
  it('FR-EDT-021: a sound document has none', () => {
    expect(problemsOf(build().doc)).toEqual([]);
  });

  it('FR-EDT-021: a binding to an element that is gone is a problem, and its fix frees the end it held', () => {
    const { doc, c, line } = build();
    const broken = without(doc, c);
    const problems = problemsOf(broken);
    const dangling = problems.find((p) => p.fix?.command === 'connector.freeEnd');
    expect(dangling?.severity).toBe('error');
    expect(dangling?.message).toContain(c);
    expect(dangling?.fix).toEqual({ title: 'Free the end', command: 'connector.freeEnd', args: { connectorId: line, end: 'target', at: { x: 960, y: 540 } } });
    // the fix, run through the document's command, leaves the end free and the document sound
    const core = createCore(broken);
    const fix = dangling?.fix;
    expect(core.execute(fix?.command ?? '', fix?.args).ok).toBe(true);
    expect(problemsOf(core.store.toDocument())).toEqual([]);
    expect((core.store.get(line) as { freeTarget?: unknown }).freeTarget).toEqual({ x: 960, y: 540 });
  });

  it('FR-EDT-021: a connector end that is neither bound nor free is a problem with the same fix', () => {
    const { doc, a, line } = build();
    const binding = Object.values(doc.records).find((r) => r.type === 'binding' && (r as { elementId?: string }).elementId === a);
    const problems = problemsOf(without(doc, (binding as { id: string }).id));
    expect(problems.map((p) => p.fix?.args)).toEqual([{ connectorId: line, end: 'source', at: { x: 960, y: 540 } }]);
    expect(problems[0]?.elements).toEqual([line]);
  });

  it('FR-EDT-021: elements exactly on top of one another are a warning; the fix offsets the top one', () => {
    const b = documentBuilder({ seed: 91 });
    const s = b.screen();
    const below = b.rect(s, { x: 10, y: 20, w: 100, h: 50 });
    const top = b.rect(s, { x: 10, y: 20, w: 100, h: 50 });
    b.rect(s, { x: 500, y: 20, w: 100, h: 50 });
    const core = createCore(b.build());
    const problems = problemsOf(core.store.toDocument());
    expect(problems).toHaveLength(1);
    const [p] = problems;
    expect([p?.severity, p?.message, [...(p?.elements ?? [])].sort()]).toEqual([
      'warning',
      '2 elements lie exactly on top of one another',
      [below, top].sort(),
    ]);
    const fix = p?.fix;
    expect(fix?.title).toBe('Offset the top one');
    expect(core.execute(fix?.command ?? '', fix?.args).ok).toBe(true);
    // the pair no longer lies exactly on top; the lint rule still sees them overlap
    expect(problemsOf(core.store.toDocument()).map((p) => p.id.split('|')[0])).toEqual(['FLX_LINT_OVERLAP']);
    const moved = (id: RecordId) => (core.store.get(id) as { transform: { x: number; y: number } }).transform;
    // exactly one of the two moved, by 16 px
    expect([moved(below), moved(top)].filter((t) => t.x === 26 && t.y === 36)).toHaveLength(1);
    // connectors do not stack; a diagnostic with no known fix is listed without one
    expect(problemsOf({ ...core.store.toDocument(), schemaVersion: '9.0' }).every((p) => p.fix === undefined)).toBe(true);
  });

  it('FR-EDT-021: a lint finding (contrast) is listed in the Problems tab', () => {
    const b = documentBuilder({ seed: 92 });
    const s = b.screen();
    const label = b.text(s, 'pale on pale', { x: 10, y: 10, w: 200, h: 50 });
    const doc = b.build();
    const styled = { ...(doc.records[label] as object), style: { fill: '#999999', font: { color: '#888888', size: 16 } } };
    const withTheme = { ...doc, records: { ...doc.records, [label]: styled, th1: { id: 'th1', type: 'theme', ...LIGHT_THEME } } } as unknown as DocumentFile;
    const found = problemsOf(withTheme).filter((p) => p.id.startsWith('FLX_LINT_CONTRAST'));
    expect(found.map((p) => [p.severity, p.elements])).toEqual([['warning', [label]]]);
  });

  it('FR-EDT-021: an element past the screen edge is listed with a fix that moves it back inside', () => {
    const b = documentBuilder({ seed: 93 });
    const s = b.screen({ size: { w: 400, h: 300 } });
    const out = b.rect(s, { x: 350, y: 10, w: 100, h: 50 });
    const core = createCore(b.build());
    const [p] = problemsOf(core.store.toDocument()).filter((x) => x.id.startsWith('FLX_LINT_OFFSCREEN'));
    expect(p?.elements).toEqual([out]);
    expect(p?.fix?.title).toBe('Move inside the screen');
    expect(core.execute(p?.fix?.command ?? '', p?.fix?.args).ok).toBe(true);
    expect((core.store.get(out) as { transform: { x: number } }).transform.x).toBe(300);
    expect(problemsOf(core.store.toDocument())).toEqual([]);
  });
});
