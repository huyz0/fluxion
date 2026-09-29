// Path templates of ADR-0016: absolute SVG path data whose numbers may be `{expr}`. Parsed into
// commands with their argument expressions; outline.ts evaluates them. One subpath: `M` first and
// only there, nothing after `Z`.
import { type Diagnostic, jsonPointer } from '@fluxion/schema';
import { type Expr, parseExpr } from '../expr/expr.js';

/**
 * One argument of a template command: its expression and the source text quoted in diagnostics.
 */
export type TemplateArg = { readonly expr: Expr; readonly src: string };

/** A command letter of a template. */
export type TemplateLetter = 'M' | 'L' | 'H' | 'V' | 'C' | 'Q' | 'A' | 'Z';

/** One command of a parsed template. */
export type TemplateCommand = { readonly letter: TemplateLetter; readonly args: readonly TemplateArg[]; readonly at: number };

/** Most commands (and so segments) one template may have (ADR-0016 item 6). */
export const MAX_SEGMENTS = 1024;

const ARITY: { readonly [L in TemplateLetter]: number } = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0 };
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** A failure inside the module, turned into the Result at `parseTemplate`'s boundary. */
export class TemplateFailure {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    this.diagnostic = diagnostic;
  }
}

/** Builds the failure of a problem in the template. */
type Fail = (code: 'FLX_SHAPE_PATH' | 'FLX_SHAPE_LIMIT', message: string) => TemplateFailure;

type Token = { readonly letter: TemplateLetter; readonly at: number } | { readonly arg: TemplateArg; readonly at: number };

/** Reads tokens of `src`; `fail` builds the diagnostic of a problem. */
class Reader {
  readonly #src: string;
  readonly #fail: Fail;
  readonly #at: ReadonlyArray<string | number>;
  #i = 0;

  constructor(src: string, at: ReadonlyArray<string | number>, fail: Fail) {
    this.#src = src;
    this.#at = at;
    this.#fail = fail;
  }

  /** The next token, or null at the end. */
  next(): Token | null {
    while (/[\s,]/.test(this.#src[this.#i] ?? '')) this.#i++;
    const at = this.#i;
    const c = this.#src[at];
    if (c === undefined) return null;
    if (c === '{') return { arg: this.#braced(at), at };
    const num = NUMBER.exec(this.#src.slice(at));
    if (num) return { arg: this.#literal(num[0], at), at };
    this.#i++;
    if (Object.hasOwn(ARITY, c)) return { letter: c as TemplateLetter, at };
    const hint = Object.hasOwn(ARITY, c.toUpperCase())
      ? `relative command "${c}" at ${at}: write it as absolute "${c.toUpperCase()}"`
      : `unexpected "${c}" at ${at}`;
    throw this.#fail('FLX_SHAPE_PATH', hint);
  }

  #braced(at: number): TemplateArg {
    const close = this.#src.indexOf('}', at);
    // tzap disable next-line EqualityOperator: `}` is never found at 0, where `{` is
    if (close < 0) throw this.#fail('FLX_SHAPE_PATH', `"{" at ${at} is not closed`);
    this.#i = close + 1;
    const src = this.#src.slice(at + 1, close);
    const parsed = parseExpr(src, this.#at);
    if (!parsed.ok) throw new TemplateFailure({ ...parsed.error, message: `${parsed.error.message} (the {…} at ${at})` });
    return { expr: parsed.value, src };
  }

  #literal(text: string, at: number): TemplateArg {
    this.#i = at + text.length;
    const value = Number(text);
    if (!Number.isFinite(value)) throw this.#fail('FLX_SHAPE_PATH', `number "${text}" at ${at} is not finite`);
    return { expr: { node: 'num', value }, src: text };
  }
}

/** The commands of one letter and the arguments after it, split by its arity (an `M`'s extra pairs are `L`s). */
function expand(letter: TemplateLetter, at: number, args: readonly TemplateArg[], fail: Fail): TemplateCommand[] {
  const arity = ARITY[letter];
  if (arity === 0 ? args.length > 0 : args.length === 0 || args.length % arity !== 0)
    throw fail('FLX_SHAPE_PATH', `"${letter}" at ${at} takes ${arity === 0 ? 'no numbers' : `numbers in groups of ${arity}`}, got ${args.length}`);
  const count = arity === 0 ? 1 : args.length / arity;
  return Array.from({ length: count }, (_, k) => ({ letter: k > 0 && letter === 'M' ? 'L' : letter, args: args.slice(k * arity, (k + 1) * arity), at }));
}

/** Groups the arguments after each letter into commands. */
function group(tokens: readonly Token[], fail: Fail): TemplateCommand[] {
  const out: TemplateCommand[] = [];
  let letter: { readonly letter: TemplateLetter; readonly at: number } | null = null;
  let args: TemplateArg[] = [];
  for (const t of tokens) {
    if ('arg' in t) {
      if (letter === null) throw fail('FLX_SHAPE_PATH', `expected a command letter at ${t.at}, found a number`);
      args.push(t.arg);
      continue;
    }
    if (letter !== null) out.push(...expand(letter.letter, letter.at, args, fail));
    [letter, args] = [t, []];
  }
  if (letter !== null) out.push(...expand(letter.letter, letter.at, args, fail));
  return out;
}

/** One subpath: `M` first and only first, nothing after `Z`, at most MAX_SEGMENTS commands. */
function checkStructure(cmds: readonly TemplateCommand[], fail: Fail): void {
  if (cmds[0]?.letter !== 'M') throw fail('FLX_SHAPE_PATH', 'a path template starts with "M"');
  for (const [k, c] of cmds.entries()) {
    if (k > 0 && c.letter === 'M') throw fail('FLX_SHAPE_PATH', `a second "M" at ${c.at} starts another subpath; an outline is one subpath`);
    if (cmds[k - 1]?.letter === 'Z') throw fail('FLX_SHAPE_PATH', `"${c.letter}" at ${c.at} follows "Z"; nothing may follow a close`);
  }
  if (cmds.length - 1 > MAX_SEGMENTS) throw fail('FLX_SHAPE_LIMIT', `the template has ${cmds.length - 1} segments; at most ${MAX_SEGMENTS}`);
}

/**
 * Parse the path template `src` found at `at`; throws a {@link TemplateFailure} (callers inside the
 * shape module catch it at their boundary).
 */
export function parseTemplate(src: string, at: ReadonlyArray<string | number>): readonly TemplateCommand[] {
  const fail: Fail = (code, message) => new TemplateFailure({ code, severity: 'error', path: jsonPointer(at), message: `${message} in path template` });
  const reader = new Reader(src, at, fail);
  const tokens: Token[] = [];
  for (let t = reader.next(); t !== null; t = reader.next()) tokens.push(t);
  const cmds = group(tokens, fail);
  checkStructure(cmds, fail);
  return cmds;
}
