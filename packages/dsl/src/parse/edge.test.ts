import { describe, expect, it } from 'vitest';
import { EDGE_OPS, edgeDiagnostic, parseEdge, parseEdgeObject } from './edge.js';

describe('edge shorthand (FR-DSL-001, FR-DSL-006, ADR-0030)', () => {
  it('FR-DSL-001: every op and every anchor suffix tokenizes', () => {
    expect(EDGE_OPS).toEqual(['->', '<-', '<->', '--', '~>']);
    for (const op of EDGE_OPS) {
      for (const [from, anchor] of [
        ['api', undefined],
        ['api.n', 'n'],
        ['api.e', 'e'],
        ['api.s', 's'],
        ['api.w', 'w'],
        ['api.out-1', 'out-1'],
      ] as const) {
        const r = parseEdge(`${from} ${op} db-main.w`);
        expect(r, `${from} ${op}`).toEqual({
          ok: true,
          edge: { from: { slug: 'api', ...(anchor ? { anchor } : {}), col: 1 }, op, to: { slug: 'db-main', anchor: 'w', col: from.length + op.length + 3 } },
        });
      }
    }
    // runs of spaces and tabs between the parts are fine
    expect(parseEdge('  a \t->   b ')).toMatchObject({ ok: true, edge: { from: { slug: 'a', col: 3 }, op: '->', to: { slug: 'b', col: 11 } } });
  });

  it('FR-DSL-006: a malformed edge is a diagnostic with its column and a hint', () => {
    const bad = (text: string) => {
      const r = parseEdge(text);
      if (r.ok) throw new Error(`${text} parsed`);
      return r;
    };
    // an op that is not one of the five, with the nearest one suggested
    expect(bad('a => b')).toMatchObject({ col: 3, hint: expect.stringContaining('->') });
    expect(bad('a ->> b')).toMatchObject({ col: 3 });
    // an op without spaces around it reads as part of a slug: say so
    expect(bad('a->b')).toMatchObject({ col: 1, hint: expect.stringContaining('spaces') });
    // a missing end, a third end, an empty anchor, a slug in capitals
    expect(bad('a ->')).toMatchObject({ col: 3 });
    expect(bad('-> b')).toMatchObject({ col: 1 });
    expect(bad('a -> b -> c')).toMatchObject({ col: 8, hint: expect.stringContaining('one edge') });
    expect(bad('a. -> b')).toMatchObject({ col: 1, message: expect.stringContaining('anchor') });
    // a slug that breaks the slug rule is FLX_DSL_BAD_SLUG (ADR-0030); every other problem FLX_DSL_EDGE_SYNTAX
    expect(bad('Api -> b')).toMatchObject({ code: 'FLX_DSL_BAD_SLUG', col: 1, message: expect.stringContaining('slug') });
    expect(bad('a => b')).toMatchObject({ code: 'FLX_DSL_EDGE_SYNTAX' });
    // an op glued between two slugs, even one that reads as a slug itself, gets the spaces hint
    expect(bad('web--api')).toMatchObject({ col: 1, hint: expect.stringContaining('spaces') });
    expect(bad('web-->api')).toMatchObject({ col: 1, hint: expect.stringContaining('spaces') });
    expect(bad('a -> b.N')).toMatchObject({ col: 6 });
    expect(bad('')).toMatchObject({ col: 1 });
  });

  it('FR-DSL-006: a malformed edge becomes FLX_DSL_EDGE_SYNTAX at its line and column in the source', () => {
    const r = parseEdge('web => api');
    if (r.ok) throw new Error('parsed');
    // the edge text starts at line 17, column 9 (offset 300) of the file
    const d = edgeDiagnostic(r, { line: 17, col: 9, endLine: 17, endCol: 19, offset: 300, end: 310 }, '/screens/0/edges/0');
    expect(d).toEqual({
      code: 'FLX_DSL_EDGE_SYNTAX',
      severity: 'error',
      path: '/screens/0/edges/0',
      message: '"=>" is not an edge op',
      hint: expect.stringContaining('"->"'),
      source: { line: 17, col: 13, endLine: 17, endCol: 14, offset: 304, end: 305 },
    });
  });

  it('FR-DSL-001: the object form { from, to, op? } tokenizes like the shorthand, op -> by default', () => {
    expect(parseEdgeObject({ from: 'api.e', to: 'db' })).toEqual({
      ok: true,
      edge: { from: { slug: 'api', anchor: 'e', col: 1 }, op: '->', to: { slug: 'db', col: 1 } },
    });
    for (const op of EDGE_OPS) expect(parseEdgeObject({ from: 'a', to: 'b', op })).toMatchObject({ ok: true, edge: { op } });
  });

  it('FR-DSL-006: a malformed object-form edge names the field, with a code, a column inside it and a hint', () => {
    expect(parseEdgeObject({ from: 'Api.', to: 'b' })).toMatchObject({ ok: false, code: 'FLX_DSL_BAD_SLUG', field: 'from' });
    expect(parseEdgeObject({ from: 'a', to: 'b.N' })).toMatchObject({
      ok: false,
      code: 'FLX_DSL_EDGE_SYNTAX',
      field: 'to',
      message: expect.stringContaining('anchor'),
    });
    expect(parseEdgeObject({ from: 'a', to: 'b', op: '=>' })).toMatchObject({ ok: false, field: 'op', hint: expect.stringContaining('"->"') });
    expect(parseEdgeObject({ from: 'a', to: 'b', op: 3 })).toMatchObject({ ok: false, field: 'op' });
    expect(parseEdgeObject({ to: 'b' })).toMatchObject({ ok: false, field: 'from' });
    expect(parseEdgeObject({ from: 'a', to: 'b c' })).toMatchObject({ ok: false, field: 'to', col: 3 });
    const r = parseEdgeObject({ from: 'Web', to: 'b' });
    if (r.ok) throw new Error('parsed');
    expect(edgeDiagnostic(r, { line: 4, col: 13, endLine: 4, endCol: 16, offset: 50, end: 53 }, '/screens/0/edges/1/from').code).toBe('FLX_DSL_BAD_SLUG');
  });
});
