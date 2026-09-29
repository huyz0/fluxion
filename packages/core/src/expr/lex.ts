// Tokens of the expression language (ADR-0016) and the error the parser and evaluator raise inside
// the module; expr.ts turns it into a diagnostic at its boundary.

type ExprCode = 'FLX_EXPR_SYNTAX' | 'FLX_EXPR_UNKNOWN' | 'FLX_EXPR_DOMAIN' | 'FLX_EXPR_BUDGET';

export class ExprError {
  readonly code: ExprCode;
  readonly message: string;
  constructor(code: ExprCode, message: string) {
    this.code = code;
    this.message = message;
  }
}

export type Token = { readonly tag: 'num' | 'id' | 'op' | 'end'; readonly text: string; readonly at: number };

const OPERATORS = ['<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '<', '>', '(', ')', ',', '?', ':'];
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** The token starting at `i` (not whitespace). */
function next(src: string, i: number): Token {
  const rest = src.slice(i);
  const num = NUMBER.exec(rest);
  if (num) return { tag: 'num', text: num[0], at: i };
  const name = NAME.exec(rest);
  if (name) return { tag: 'id', text: name[0], at: i };
  const op = OPERATORS.find((o) => rest.startsWith(o));
  if (op === undefined) throw new ExprError('FLX_EXPR_SYNTAX', `unexpected "${src[i]}" at ${i}`);
  return { tag: 'op', text: op, at: i };
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i] as string)) {
      i++;
      continue;
    }
    const token = next(src, i);
    tokens.push(token);
    i += token.text.length;
  }
  tokens.push({ tag: 'end', text: '', at: src.length });
  return tokens;
}
