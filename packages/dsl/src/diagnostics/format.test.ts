import { describe, expect, it } from 'vitest';
import type { DslDiagnostic } from '../types.js';
import { DSL_CODES } from './codes.js';
import { formatDiagnostics } from './format.js';

const at = (line: number, col: number) => ({ line, col, endLine: line, endCol: col + 1, offset: 0, end: 1 });
type Spec = { code: DslDiagnostic['code']; severity: DslDiagnostic['severity']; line: number; col: number; message: string; hint?: string; path?: string };
const d = ({ code, severity, line, col, message, hint, path = '/screens/0' }: Spec): DslDiagnostic => ({
  code,
  severity,
  path,
  message,
  source: at(line, col),
  ...(hint === undefined ? {} : { hint }),
});

describe('diagnostics for people and models (FR-DSL-006, ADR-0030)', () => {
  it('FR-DSL-006: the code registry holds the ten FluxScript codes of ADR-0030 with their severities', () => {
    expect(Object.keys(DSL_CODES).sort()).toEqual([
      'FLX_DSL_AMBIGUOUS_SHAPE',
      'FLX_DSL_BAD_SLUG',
      'FLX_DSL_DUP_SLUG',
      'FLX_DSL_EDGE_SYNTAX',
      'FLX_DSL_NOT_YET',
      'FLX_DSL_SYNTAX',
      'FLX_DSL_UNKNOWN_KEY',
      'FLX_DSL_UNKNOWN_PACK',
      'FLX_DSL_UNKNOWN_SHAPE',
      'FLX_DSL_VERSION',
    ]);
    expect(DSL_CODES.FLX_DSL_NOT_YET.severity).toBe('warning');
    expect(DSL_CODES.FLX_DSL_UNKNOWN_PACK.severity).toBe('warning');
    expect(DSL_CODES.FLX_DSL_SYNTAX.severity).toBe('error');
    for (const [code, entry] of Object.entries(DSL_CODES)) expect(entry.description.length, code).toBeGreaterThan(10);
  });

  it('FR-DSL-006: the formatter writes one line per diagnostic with line, column, severity, code, message and hint', () => {
    const lines = formatDiagnostics([
      d({ code: 'FLX_REF_MISSING', severity: 'error', line: 23, col: 9, message: "edge target 'dbb' not found", hint: "did you mean 'db'?" }),
    ]);
    expect(lines).toEqual(["L23:9  error   FLX_REF_MISSING  edge target 'dbb' not found — hint: did you mean 'db'?"]);
    // without a source range the position is the path
    const noSource: DslDiagnostic = { code: 'FLX_DSL_VERSION', severity: 'error', path: '/flux', message: 'flux must be 1' };
    expect(formatDiagnostics([noSource])).toEqual(['/flux  error   FLX_DSL_VERSION  flux must be 1']);
  });

  it('FR-DSL-006: the formatter ranks errors first then by position, dedupes one per root cause, and caps the list', () => {
    const list = [
      d({ code: 'FLX_DSL_NOT_YET', severity: 'warning', line: 2, col: 1, message: 'steps are kept, not compiled' }),
      d({ code: 'FLX_DSL_UNKNOWN_SHAPE', severity: 'error', line: 9, col: 5, message: "unknown shape 'rect2'" }),
      d({ code: 'FLX_DSL_SYNTAX', severity: 'error', line: 3, col: 2, message: 'bad indentation' }),
      d({ code: 'FLX_DSL_UNKNOWN_SHAPE', severity: 'error', line: 9, col: 5, message: "unknown shape 'rect2'" }),
      d({ code: 'FLX_DSL_UNKNOWN_KEY', severity: 'info', line: 1, col: 1, message: 'note' }),
      d({ code: 'FLX_DSL_SYNTAX', severity: 'error', line: 3, col: 1, message: 'bad indentation' }),
    ];
    const lines = formatDiagnostics(list);
    expect(lines.map((l) => l.split(/\s+/)[0])).toEqual(['L3:1', 'L3:2', 'L9:5', 'L2:1', 'L1:1']);
    // the cap keeps the first n after ranking and says how many are left
    const many = Array.from({ length: 25 }, (_, i) => d({ code: 'FLX_DSL_SYNTAX', severity: 'error', line: i + 1, col: 1, message: `problem ${i}` }));
    const capped = formatDiagnostics(many);
    expect(capped).toHaveLength(21);
    expect(capped[19]).toContain('problem 19');
    expect(capped[20]).toBe('+5 more');
    expect(formatDiagnostics(many, { cap: 3 }).at(-1)).toBe('+22 more');
    expect(formatDiagnostics([])).toEqual([]);
  });

  it('FR-DSL-006: ties fall back to the path, and diagnostics without a place in the source come after those with one', () => {
    const tie = (path: string) => d({ code: 'FLX_DSL_SYNTAX', severity: 'error', line: 4, col: 2, message: `at ${path}`, path });
    expect(formatDiagnostics([tie('/b'), tie('/a'), tie('/a')]).map((l) => l.split('  ').at(-1))).toEqual(['at /a', 'at /b']);
    const placeless: DslDiagnostic = { code: 'FLX_DSL_VERSION', severity: 'error', path: '/flux', message: 'no version' };
    const placed = d({ code: 'FLX_DSL_SYNTAX', severity: 'error', line: 900, col: 1, message: 'late' });
    expect(formatDiagnostics([placeless, placed]).map((l) => l.split(/\s+/)[0])).toEqual(['L900:1', '/flux']);
    expect(formatDiagnostics([placed, placeless]).map((l) => l.split(/\s+/)[0])).toEqual(['L900:1', '/flux']);
    // the same place and code with another message is another root cause, and stays
    expect(formatDiagnostics([placed, { ...placed, message: 'later' }])).toHaveLength(2);
  });
});
