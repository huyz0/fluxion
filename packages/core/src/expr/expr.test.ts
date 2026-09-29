import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Expr, type ExprBudget, evaluateExpr, parseExpr, runExpr } from './expr.js';

const budget = (steps = 10_000): ExprBudget => ({ steps });
const value = (src: string, scope: Record<string, number> = {}) => {
  const r = runExpr(src, scope, budget());
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const code = (src: string, scope: Record<string, number> = {}, b = budget()) => {
  const r = runExpr(src, scope, b, ['outline', 'path']);
  return r.ok ? 'ok' : r.error.code;
};

describe('expression language (ADR-0016, FR-SHP-003)', () => {
  it('evaluates arithmetic, precedence, comparisons, conditionals and the function table', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('-2 * -3 - -1')).toBe(7);
    expect(value('10 % 4 / 2')).toBe(1);
    expect(value('w / 2 + h', { w: 100, h: 5 })).toBe(55);
    expect(value('.5 + 1.25e2')).toBe(125.5);
    expect(value('i % 2 ? inner : 1', { i: 3, inner: 0.4 })).toBe(0.4);
    expect(value('i % 2 ? inner : 1', { i: 2, inner: 0.4 })).toBe(1);
    expect(value('1 < 2')).toBe(1);
    expect(value('2 <= 1')).toBe(0);
    expect(value('3 > 2 ? 3 >= 3 : 0')).toBe(1);
    expect(value('1 == 1')).toBe(1);
    expect(value('1 != 1')).toBe(0);
    // conditionals nest to the right
    expect(value('0 ? 1 : 0 ? 2 : 3')).toBe(3);
    expect(value('min(4, 2, 9) + max(1) + abs(-3) + sqrt(16) + floor(1.7) + ceil(1.2) + round(2.5)')).toBe(2 + 1 + 3 + 4 + 1 + 2 + 3);
    expect(value('sin(0) + cos(0) + tan(0) + atan2(0, 1) + clamp(5, 0, 2) + clamp(-1, 0, 2)')).toBe(3);
    expect(value('2 * pi', { pi: Math.PI })).toBeCloseTo(2 * Math.PI, 12);
  });

  it('FR-SHP-003: an unknown identifier or an exhausted step budget returns a diagnostic', () => {
    const unknown = runExpr('w + depth', { w: 1 }, budget(), ['outline', 'path']);
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? null : unknown.error).toMatchObject({ code: 'FLX_EXPR_UNKNOWN', severity: 'error', path: '/outline/path' });
    expect(unknown.ok ? '' : unknown.error.message).toContain('unknown name "depth"');
    expect(code('hypot(3, 4)')).toBe('FLX_EXPR_UNKNOWN');
    // prototype names are unknown, not Object.prototype's members
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(code(name)).toBe('FLX_EXPR_UNKNOWN');
    expect(code('constructor(1)')).toBe('FLX_EXPR_UNKNOWN');
    // the budget is shared across evaluations and counts every node
    const shared = budget(12);
    expect(code('1 + 2 + 3', {}, shared)).toBe('ok');
    expect(shared.steps).toBe(7);
    expect(code('1 + 2 + 3 + 4 + 5', {}, shared)).toBe('FLX_EXPR_BUDGET');
    expect(code('1', {}, budget(0))).toBe('FLX_EXPR_BUDGET');
    // domain errors
    for (const src of ['1 / 0', '1 % 0', 'sqrt(-1)', '1e308 * 10']) expect(code(src)).toBe('FLX_EXPR_DOMAIN');
    expect(code('w', { w: Number.NaN })).toBe('FLX_EXPR_DOMAIN');
    // syntax errors
    for (const src of ['', '1 +', '(1', '1 2', 'w.x', 'a[0]', '"s"', '1 ? 2', 'min()', 'abs(1, 2)', 'atan2(1)', '()', ')'])
      expect(code(src, { w: 1, a: 1 }), src).toBe('FLX_EXPR_SYNTAX');
    expect(code(`${'('.repeat(70)}1${')'.repeat(70)}`)).toBe('FLX_EXPR_SYNTAX');
    expect(code(`${'-'.repeat(70)}1`)).toBe('FLX_EXPR_SYNTAX');
    expect(code('1+'.repeat(1100) + '1')).toBe('FLX_EXPR_SYNTAX');
  });

  it('FR-SHP-003: 10 000 fuzzed templates never throw and never run code', () => {
    // tokens of the language and of JavaScript that must not reach any runtime
    const token = fc.constantFrom(
      '1',
      '0',
      '2.5',
      'w',
      'h',
      'i',
      'n',
      'pi',
      'inner',
      'x',
      '+',
      '-',
      '*',
      '/',
      '%',
      '<',
      '>=',
      '==',
      '!=',
      '?',
      ':',
      '(',
      ')',
      ',',
      'min',
      'max',
      'sqrt',
      'clamp',
      'constructor',
      '__proto__',
      'eval',
      'Function',
      'globalThis',
      'process',
      'this',
      '.',
      '[',
      ']',
      '"',
      "'",
      '`',
      '=>',
      '=',
      ';',
      '{',
      '}',
    );
    const source = fc.oneof(
      fc.array(token, { maxLength: 24 }).map((t) => t.join(' ')),
      fc.string({ maxLength: 40 }),
    );
    let evaluated = 0;
    fc.assert(
      fc.property(source, (src) => {
        const r = runExpr(src, { w: 100, h: 50, i: 3, n: 8, pi: Math.PI, inner: 0.5 }, budget(500));
        if (r.ok) {
          expect(Number.isFinite(r.value)).toBe(true);
          evaluated++;
        } else {
          expect(r.error.code).toMatch(/^FLX_EXPR_(SYNTAX|UNKNOWN|DOMAIN|BUDGET)$/);
        }
      }),
      { numRuns: 10_000 },
    );
    // the generator reaches valid expressions, not only errors
    expect(evaluated).toBeGreaterThan(100);
  });

  it('parses once and evaluates many times against different scopes', () => {
    const parsed = parseExpr('w / 2 + i', ['p']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ node: 'bin', op: '+' });
    const long = parseExpr('x'.repeat(2001));
    expect(long.ok ? '' : long.error.message).toContain('longer than 2000');
  });
});

describe('expression diagnostics and limits (ADR-0016)', () => {
  const message = (src: string, scope: Record<string, number> = {}) => {
    const r = runExpr(src, scope, budget(100), ['o']);
    return r.ok ? r.value : `${r.error.code} ${r.error.path} ${r.error.message}`;
  };

  it('diagnostics name what failed and where', () => {
    expect(message('')).toBe('FLX_EXPR_SYNTAX /o expected a number, a name or "(" at 0, found "end"');
    expect(message('1 +')).toBe('FLX_EXPR_SYNTAX /o expected a number, a name or "(" at 3, found "end" in "1 +"');
    expect(message('(1')).toBe('FLX_EXPR_SYNTAX /o expected ")" at 2, found "end" in "(1"');
    expect(message('1 2')).toBe('FLX_EXPR_SYNTAX /o unexpected "2" at 2 in "1 2"');
    expect(message('w.x')).toBe('FLX_EXPR_SYNTAX /o unexpected "." at 1 in "w.x"');
    expect(message('1 ? 2')).toBe('FLX_EXPR_SYNTAX /o expected ":" at 5, found "end" in "1 ? 2"');
    expect(message('min()')).toBe('FLX_EXPR_SYNTAX /o min takes at least 1 argument, got 0 in "min()"');
    expect(message('abs(1, 2)')).toBe('FLX_EXPR_SYNTAX /o abs takes 1 argument, got 2 in "abs(1, 2)"');
    expect(message('atan2(1)')).toBe('FLX_EXPR_SYNTAX /o atan2 takes 2 arguments, got 1 in "atan2(1)"');
    expect(message('()')).toBe('FLX_EXPR_SYNTAX /o expected a number, a name or "(" at 1, found ")" in "()"');
    expect(message('depth')).toBe('FLX_EXPR_UNKNOWN /o unknown name "depth" at 0 in "depth"');
    expect(message('1 + hypot(1)')).toBe('FLX_EXPR_UNKNOWN /o unknown function "hypot" at 4 in "1 + hypot(1)"');
    expect(message('1 / 0')).toBe('FLX_EXPR_DOMAIN /o division by zero in "1 / 0"');
    expect(message('1 % 0')).toBe('FLX_EXPR_DOMAIN /o modulo by zero in "1 % 0"');
    // a literal that overflows is refused, wherever it stands
    expect(message('1 ? 1e999 : 0')).toBe('FLX_EXPR_DOMAIN /o number "1e999" at 4 is not finite in "1 ? 1e999 : 0"');
    for (const src of ['1e999', '-1e999', '1e308 * 0 + 2e308']) expect(code(src), src).toBe('FLX_EXPR_DOMAIN');
    expect(message('1e308')).toBe(1e308);
    expect(message('sqrt(-1)')).toBe('FLX_EXPR_DOMAIN /o sqrt(…) at 0 is not a finite number in "sqrt(-1)"');
    expect(message('1e308 * 10')).toBe('FLX_EXPR_DOMAIN /o "*" at 6 is not a finite number in "1e308 * 10"');
    expect(message('-w', { w: Number.NaN })).toBe('FLX_EXPR_DOMAIN /o "w" is not a finite number in "-w"');
    expect(message('1 + 1 + 1', {})).toBe(3);
    expect(message('(1, 2)')).toBe('FLX_EXPR_SYNTAX /o expected ")" at 2, found "," in "(1, 2)"');
    expect(message('1 ? 2 , 3')).toBe('FLX_EXPR_SYNTAX /o expected ":" at 6, found "," in "1 ? 2 , 3"');
    expect(message(`${'('.repeat(64)}1${')'.repeat(64)}`)).toMatch(/^FLX_EXPR_SYNTAX \/o nested deeper than 64 levels in /);
    // function names and arity are checked when parsing, so a branch never taken is checked too
    expect(parseExpr('abs(1, 2)').ok).toBe(false);
    expect(code('0 ? abs(1, 2) : 1')).toBe('FLX_EXPR_SYNTAX');
    expect(code('0 ? hypot(1) : 1')).toBe('FLX_EXPR_UNKNOWN');
    // a hand-built AST is checked again when evaluated
    const at0 = { node: 'num', value: 0 } as const;
    const handBuilt = (name: string, args: Expr[]) => {
      const r = evaluateExpr({ node: 'call', name, args, at: 0 }, {}, budget());
      return r.ok ? r.value : r.error.message;
    };
    expect(handBuilt('hypot', [at0])).toBe('unknown function "hypot" at 0');
    expect(handBuilt('abs', [at0, at0])).toBe('abs takes 1 argument, got 2');
    expect(handBuilt('abs', [at0])).toBe(0);
    // evaluating a parsed expression without a location reports at the root, unquoted
    const parsed = parseExpr('1 / 0');
    const bare0 = parsed.ok ? evaluateExpr(parsed.value, {}, budget()) : parsed;
    expect(bare0.ok ? null : bare0.error).toMatchObject({ path: '', message: 'division by zero' });
    const spent = runExpr('1 + 1', {}, budget(2), ['o']);
    expect(spent.ok ? '' : spent.error.message).toBe('the step budget is exhausted in "1 + 1"');
    // long sources are quoted up to 80 characters
    const q = (src: string) => {
      const r = runExpr(src, {}, budget(), []);
      return r.ok ? '' : r.error.message.slice(r.error.message.indexOf(' in "') + 5, -1);
    };
    expect(q(`${'1'.repeat(78)} +`)).toBe(`${'1'.repeat(78)} +`);
    expect(q(`${'1'.repeat(79)} +`)).toBe(`${'1'.repeat(77)}...`);
    // without a path the pointer is the root
    const bare = parseExpr('1 +');
    expect(bare.ok ? 'ok' : bare.error.path).toBe('');
    const run = runExpr('x', {}, budget());
    expect(run.ok ? 'ok' : run.error.path).toBe('');
  });

  it('operators and functions hold at their boundaries', () => {
    const cases: [string, number][] = [
      ['1 < 1', 0],
      ['1 < 2', 1],
      ['2 < 1', 0],
      ['1 <= 1', 1],
      ['2 <= 1', 0],
      ['2 > 2', 0],
      ['3 > 2', 1],
      ['1 > 2', 0],
      ['2 >= 2', 1],
      ['1 >= 2', 0],
      ['2 == 2', 1],
      ['1 == 2', 0],
      ['1 != 2', 1],
      ['2 != 2', 0],
      ['max(1, 5, 3)', 5],
      ['min(4, -2, 9)', -2],
      ['10 + .25 + 1e+2 + 2E-1 + 12.', 122.45],
      ['7 - 2 - 1', 4],
      ['12 / 3 / 2', 2],
    ];
    for (const [src, want] of cases) expect(value(src), src).toBeCloseTo(want, 12);
  });

  it('nesting, source length and budget stop exactly at their limits', () => {
    const parens = (k: number) => `${'('.repeat(k)}1${')'.repeat(k)}`;
    expect(code(parens(63))).toBe('ok');
    expect(code(parens(64))).toBe('FLX_EXPR_SYNTAX');
    expect(code(`${'-'.repeat(63)}1`)).toBe('ok');
    expect(code(`${'-'.repeat(64)}1`)).toBe('FLX_EXPR_SYNTAX');
    // depth is released after each group: two deep groups side by side parse
    expect(code(`${parens(60)} + ${parens(60)}`)).toBe('ok');
    expect(code(`1${' '.repeat(1999)}`)).toBe('ok');
    expect(code(`1${' '.repeat(2000)}`)).toBe('FLX_EXPR_SYNTAX');
    expect(code('1', {}, budget(1))).toBe('ok');
    expect(code('-1', {}, budget(1))).toBe('FLX_EXPR_BUDGET');
  });
});
