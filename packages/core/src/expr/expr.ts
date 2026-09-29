// The safe expression language of ADR-0016 (FR-SHP-003): shape outline templates, later bindings.
// A hand-written tokenizer and recursive-descent parser build an AST; a tree-walking evaluator runs it
// against a scope of numbers with a step budget. Nothing here can run code: identifiers resolve only
// to the scope's own keys and to a fixed function table, and every failure is a diagnostic, never an
// exception.
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { ExprError, type Token, tokenize } from './lex.js';

/**
 * A binary operator of the language.
 *
 * @public
 */
export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=';

/**
 * A parsed expression.
 *
 * @public
 */
export type Expr =
  | {
      /** A number literal. */
      readonly node: 'num';
      /** Its value, always finite. */
      readonly value: number;
    }
  | {
      /** A name read from the scope. */
      readonly node: 'id';
      /** The name. */
      readonly name: string;
      /** Offset of the name in the source. */
      readonly at: number;
    }
  | {
      /** Unary minus. */
      readonly node: 'neg';
      /** The negated operand. */
      readonly arg: Expr;
    }
  | {
      /** A binary operator. */
      readonly node: 'bin';
      /** The operator. */
      readonly op: BinaryOp;
      /** Left operand. */
      readonly left: Expr;
      /** Right operand. */
      readonly right: Expr;
      /** Offset of the operator in the source. */
      readonly at: number;
    }
  | {
      /** `test ? then : otherwise`. */
      readonly node: 'cond';
      /** Non-zero selects `then`. */
      readonly test: Expr;
      /** Value when `test` is non-zero. */
      readonly then: Expr;
      /** Value when `test` is zero. */
      readonly otherwise: Expr;
    }
  | {
      /** A call of the function table. */
      readonly node: 'call';
      /** The function's name. */
      readonly name: string;
      /** The arguments, in order. */
      readonly args: readonly Expr[];
      /** Offset of the name in the source. */
      readonly at: number;
    };

/**
 * The names an expression may read, each bound to a number.
 *
 * @public
 */
export type ExprScope = { readonly [name: string]: number };

/**
 * A step budget shared by every evaluation of one job (an outline and its decorations); `steps` counts
 * down and an evaluation that would go below zero stops with `FLX_EXPR_BUDGET`.
 *
 * @public
 */
export type ExprBudget = {
  /** Steps left; each AST node evaluated spends one. */
  steps: number;
};

/**
 * Where an expression comes from, for its diagnostics: a JSON pointer into the definition and the
 * source text.
 *
 * @public
 */
export type ExprWhere = {
  /** Path segments of the JSON pointer. */
  readonly at?: ReadonlyArray<string | number>;
  /** The source text, quoted in the message. */
  readonly src?: string;
};

/** Longest source text and deepest nesting the parser accepts (deeper input would grow the stack). */
const MAX_SOURCE = 2000;
const MAX_DEPTH = 64;

type Fn = { readonly arity: number; readonly variadic?: boolean; readonly fn: (a: readonly number[]) => number };
const one = (f: (x: number) => number): Fn => ({ arity: 1, fn: (a) => f(a[0] as number) });

/** The function table: arity (or minimum arity for variadics) and the implementation. */
const FUNCTIONS: { readonly [name: string]: Fn } = {
  min: { arity: 1, variadic: true, fn: (a) => Math.min(...a) },
  max: { arity: 1, variadic: true, fn: (a) => Math.max(...a) },
  abs: one(Math.abs),
  sqrt: one(Math.sqrt),
  sin: one(Math.sin),
  cos: one(Math.cos),
  tan: one(Math.tan),
  floor: one(Math.floor),
  ceil: one(Math.ceil),
  round: one(Math.round),
  atan2: { arity: 2, fn: (a) => Math.atan2(a[0] as number, a[1] as number) },
  clamp: { arity: 3, fn: (a) => Math.min(Math.max(a[0] as number, a[1] as number), a[2] as number) },
};

const RELATIONS = ['<', '<=', '>', '>=', '==', '!='];

/** Recursive descent: cond := cmp ('?' cond ':' cond)?; cmp := add (rel add)?; add := mul (±mul)*; … */
class Parser {
  readonly #tokens: readonly Token[];
  #i = 0;
  #depth = 0;

  constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  /** The next token, not taken (a method, so a check before a take narrows nothing later). */
  #peek(): Token {
    return this.#tokens[this.#i] as Token;
  }

  #take(): Token {
    return this.#tokens[this.#i++] as Token;
  }

  /** True when the next token is one of the operators `ops`. */
  #at(...ops: string[]): boolean {
    const t = this.#peek();
    // tzap disable next-line ConditionalExpression: only op tokens carry operator text; the tag check states intent
    return t.tag === 'op' && ops.includes(t.text);
  }

  #expect(text: string): void {
    const t = this.#take();
    // tzap disable next-line ConditionalExpression,LogicalOperator: only op tokens carry operator text; the tag check states intent
    if (t.tag !== 'op' || t.text !== text) throw new ExprError('FLX_EXPR_SYNTAX', `expected "${text}" at ${t.at}, found "${t.text || 'end'}"`);
  }

  #nested<T>(parse: () => T): T {
    if (++this.#depth > MAX_DEPTH) throw new ExprError('FLX_EXPR_SYNTAX', `nested deeper than ${MAX_DEPTH} levels`);
    try {
      return parse();
    } finally {
      this.#depth--;
    }
  }

  parse(): Expr {
    const e = this.#cond();
    const t = this.#peek();
    if (t.tag !== 'end') throw new ExprError('FLX_EXPR_SYNTAX', `unexpected "${t.text}" at ${t.at}`);
    return e;
  }

  #cond(): Expr {
    return this.#nested(() => {
      const test = this.#cmp();
      if (!this.#at('?')) return test;
      this.#take();
      const then = this.#cond();
      this.#expect(':');
      return { node: 'cond', test, then, otherwise: this.#cond() };
    });
  }

  #cmp(): Expr {
    const left = this.#add();
    if (!this.#at(...RELATIONS)) return left;
    const t = this.#take();
    return { node: 'bin', op: t.text as BinaryOp, left, right: this.#add(), at: t.at };
  }

  #add(): Expr {
    let left = this.#mul();
    while (this.#at('+', '-')) {
      const t = this.#take();
      left = { node: 'bin', op: t.text as BinaryOp, left, right: this.#mul(), at: t.at };
    }
    return left;
  }

  #mul(): Expr {
    let left = this.#unary();
    while (this.#at('*', '/', '%')) {
      const t = this.#take();
      left = { node: 'bin', op: t.text as BinaryOp, left, right: this.#unary(), at: t.at };
    }
    return left;
  }

  #unary(): Expr {
    if (!this.#at('-')) return this.#primary();
    this.#take();
    return this.#nested(() => ({ node: 'neg', arg: this.#unary() }));
  }

  #primary(): Expr {
    const t = this.#take();
    if (t.tag === 'num') {
      const value = Number(t.text);
      if (!Number.isFinite(value)) throw new ExprError('FLX_EXPR_DOMAIN', `number "${t.text}" at ${t.at} is not finite`);
      return { node: 'num', value };
    }
    // tzap disable next-line ConditionalExpression: only op tokens carry operator text; the tag check states intent
    if (t.tag === 'op' && t.text === '(') {
      const e = this.#cond();
      this.#expect(')');
      return e;
    }
    if (t.tag !== 'id') throw new ExprError('FLX_EXPR_SYNTAX', `expected a number, a name or "(" at ${t.at}, found "${t.text || 'end'}"`);
    if (!this.#at('(')) return { node: 'id', name: t.text, at: t.at };
    this.#take();
    const e: Extract<Expr, { node: 'call' }> = { node: 'call', name: t.text, args: this.#args(), at: t.at };
    // the function table is fixed, so names and arity are checked here, in branches never taken too
    resolve(e);
    return e;
  }

  #args(): Expr[] {
    const args: Expr[] = [];
    if (!this.#at(')')) {
      args.push(this.#cond());
      while (this.#at(',')) {
        this.#take();
        args.push(this.#cond());
      }
    }
    this.#expect(')');
    return args;
  }
}

const toDiagnostic = (e: ExprError, where: ExprWhere): Diagnostic => {
  const src = where.src ?? '';
  const quoted = src.length > 80 ? `${src.slice(0, 77)}...` : src;
  return { code: e.code, severity: 'error', path: jsonPointer(where.at ?? []), message: src ? `${e.message} in "${quoted}"` : e.message };
};

/** Runs `job`, turning an ExprError into its diagnostic; any other error is a bug and propagates. */
function guarded<T>(job: () => T, where: ExprWhere): Result<T, Diagnostic> {
  try {
    return ok(job());
  } catch (e) {
    if (e instanceof ExprError) return err(toDiagnostic(e, where));
    throw e;
  }
}

/**
 * Parse `src`; a diagnostic at `at` (a JSON pointer into the definition) on a syntax error.
 *
 * @public
 */
export function parseExpr(src: string, at: ReadonlyArray<string | number> = []): Result<Expr, Diagnostic> {
  return guarded(
    () => {
      if (src.length > MAX_SOURCE) throw new ExprError('FLX_EXPR_SYNTAX', `longer than ${MAX_SOURCE} characters`);
      return new Parser(tokenize(src)).parse();
    },
    { at, src },
  );
}

/** A finite number, or a domain error naming what produced it. */
function finite(v: number, what: string): number {
  if (!Number.isFinite(v)) throw new ExprError('FLX_EXPR_DOMAIN', `${what} is not a finite number`);
  return v;
}

function divisor(b: number, what: string): number {
  if (b === 0) throw new ExprError('FLX_EXPR_DOMAIN', `${what} by zero`);
  return b;
}

const BINARY: { readonly [op in BinaryOp]: (a: number, b: number) => number } = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / divisor(b, 'division'),
  '%': (a, b) => a % divisor(b, 'modulo'),
  '<': (a, b) => Number(a < b),
  '<=': (a, b) => Number(a <= b),
  '>': (a, b) => Number(a > b),
  '>=': (a, b) => Number(a >= b),
  '==': (a, b) => Number(a === b),
  '!=': (a, b) => Number(a !== b),
};

/** A name of the scope: its own keys only, so `constructor` and `__proto__` are unknown. */
function lookup(e: Extract<Expr, { node: 'id' }>, scope: ExprScope): number {
  if (!Object.hasOwn(scope, e.name)) throw new ExprError('FLX_EXPR_UNKNOWN', `unknown name "${e.name}" at ${e.at}`);
  return finite(scope[e.name] as number, `"${e.name}"`);
}

/** The function a call names, looked up among the table's own keys only, with its arity checked. */
function resolve(e: Extract<Expr, { node: 'call' }>): Fn {
  const f = Object.hasOwn(FUNCTIONS, e.name) ? FUNCTIONS[e.name] : undefined;
  if (f === undefined) throw new ExprError('FLX_EXPR_UNKNOWN', `unknown function "${e.name}" at ${e.at}`);
  if (f.variadic ? e.args.length < f.arity : e.args.length !== f.arity) {
    const count = `${f.variadic ? 'at least ' : ''}${f.arity} argument${f.arity === 1 ? '' : 's'}`;
    throw new ExprError('FLX_EXPR_SYNTAX', `${e.name} takes ${count}, got ${e.args.length}`);
  }
  return f;
}

/** A call of the function table; checked again here, since an AST may be built by hand. */
function call(e: Extract<Expr, { node: 'call' }>, scope: ExprScope, budget: ExprBudget): number {
  const f = resolve(e);
  return finite(f.fn(e.args.map((a) => run(a, scope, budget))), `${e.name}(…) at ${e.at}`);
}

/** A binary operator of the table's own keys (an AST may be built by hand). */
function binary(e: Extract<Expr, { node: 'bin' }>, scope: ExprScope, budget: ExprBudget): number {
  if (!Object.hasOwn(BINARY, e.op)) throw new ExprError('FLX_EXPR_SYNTAX', `unknown operator "${e.op}" at ${e.at}`);
  return finite(BINARY[e.op](run(e.left, scope, budget), run(e.right, scope, budget)), `"${e.op}" at ${e.at}`);
}

function run(e: Expr, scope: ExprScope, budget: ExprBudget): number {
  if (--budget.steps < 0) throw new ExprError('FLX_EXPR_BUDGET', 'the step budget is exhausted');
  switch (e.node) {
    case 'num':
      // the parser refuses overflowing literals; a hand-built AST is checked here
      return finite(e.value, 'a number literal');
    case 'id':
      return lookup(e, scope);
    case 'neg':
      return -run(e.arg, scope, budget);
    case 'bin':
      return binary(e, scope, budget);
    case 'cond':
      return run(e.test, scope, budget) !== 0 ? run(e.then, scope, budget) : run(e.otherwise, scope, budget);
    case 'call':
      return call(e, scope, budget);
  }
  throw new ExprError('FLX_EXPR_SYNTAX', `unknown node ${JSON.stringify((e as { node: unknown }).node)}`);
}

/**
 * Evaluate `expr` against `scope`, spending `budget`; a diagnostic at `where.at` for an unknown name
 * or function, a division by zero, a non-finite result or an exhausted budget.
 *
 * @public
 */
export function evaluateExpr(expr: Expr, scope: ExprScope, budget: ExprBudget, where: ExprWhere = {}): Result<number, Diagnostic> {
  return guarded(() => run(expr, scope, budget), where);
}

/**
 * Parse and evaluate `src` in one call.
 *
 * @public
 */
export function runExpr(src: string, scope: ExprScope, budget: ExprBudget, at: ReadonlyArray<string | number> = []): Result<number, Diagnostic> {
  const parsed = parseExpr(src, at);
  return parsed.ok ? evaluateExpr(parsed.value, scope, budget, { at, src }) : parsed;
}
