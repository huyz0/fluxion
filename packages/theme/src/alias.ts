// Resolving a colour token (ADR-0152): a colour token's value is a literal colour or an alias `{path}` to another colour
// token, and it may carry `$extensions["dev.fluxion"].transform`, steps applied in OKLCH to the colour its value gives. Aliases of
// aliases and derived tokens of derived tokens are followed recursively; the links followed (aliases and `mix.with`) are kept, so
// a cycle is reported and never looped over. Pure.
import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { type ColorStep, deriveOklch, oklchToCss, parseColor } from './oklch.js';
import { isToken, isValidToken, nodeAt, type Theme, TOKEN_REF, type Token, tokenEntries } from './tokens.js';

/** The longest chain of links followed: far more than any theme writes, and a bound on the work a hostile theme can ask for. */
const MAX_CHAIN = 64;

/** The extension key a Fluxion transform lives under. */
export const EXTENSION_KEY = 'dev.fluxion';

const isObject = (v: unknown): v is { readonly [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const fraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const alias = (v: unknown): v is string => typeof v === 'string' && TOKEN_REF.test(v);

/**
 * Whether a colour token has to be resolved before it can be emitted: its value is an alias, or it carries transform steps.
 * Package-internal.
 */
export const needsResolving = (token: Token): boolean =>
  token.$type === 'color' && (TOKEN_REF.test(token.$value) || isObject(token.$extensions?.[EXTENSION_KEY]));

/** The transform steps a token carries, as written (undefined when it has none). */
const rawSteps = (token: Token): unknown =>
  isObject(token.$extensions?.[EXTENSION_KEY]) ? (token.$extensions[EXTENSION_KEY] as { transform?: unknown }).transform : undefined;

/** The theme error of a step that is not one of the four operations with in-range numbers. */
const badStep = (theme: Theme, at: string, why: string): ThemeError => ({ code: 'TOKEN_TRANSFORM', message: `{${at}} of theme ${theme.name}: ${why}` });

type Step = { readonly op: 'lighten' | 'darken' | 'alpha'; readonly n: number } | { readonly op: 'mix'; readonly with: string; readonly amount: number };

/** One step read strictly: a step, or why it is not one. */
function readStep(step: unknown): Step | string {
  const keys = isObject(step) ? Object.keys(step) : [];
  const [op] = keys;
  if (!isObject(step) || keys.length !== 1 || op === undefined) return 'a step has exactly one operation';
  const value = step[op];
  if (op === 'lighten' || op === 'darken' || op === 'alpha') return fraction(value) ? { op, n: value } : `${op} takes a number from 0 to 1`;
  if (op !== 'mix') return `unknown operation ${JSON.stringify(op)}`;
  const m = isObject(value) ? value : {};
  return alias(m['with']) && fraction(m['amount']) ? { op: 'mix', with: m['with'], amount: m['amount'] } : 'mix takes { with: an alias, amount: 0 to 1 }';
}

/** The steps of `token` read strictly: one operation each, numbers in [0, 1], `mix.with` an alias. */
function readSteps(theme: Theme, at: string, raw: unknown): Result<readonly Step[], ThemeError> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw) || raw.length === 0) return err(badStep(theme, at, 'a transform is a non-empty list of steps'));
  const out: Step[] = [];
  for (const step of raw) {
    const read = readStep(step);
    if (typeof read === 'string') return err(badStep(theme, at, read));
    out.push(read);
  }
  return ok(out);
}

/** What one resolver shares across its calls: the theme, the colours already resolved, and the links it may still follow. */
type Cx = { readonly theme: Theme; readonly memo: Map<string, Resolved>; left: number };

/** A resolved colour and the height of the chain of links under it (itself counts), so the depth bound holds whatever the order of lookups. */
type Resolved = { readonly css: string; readonly height: number };

/** The colour of the colour token at `path` as CSS text, following links; `visiting` is the chain so far. */
function resolve(cx: Cx, path: string, visiting: readonly string[]): Result<Resolved, ThemeError> {
  const { theme } = cx;
  if (visiting.includes(path)) {
    return err({
      code: 'TOKEN_CYCLE',
      message: `the links of theme ${theme.name} return to {${path}}: ${[...visiting, path].map((p) => `{${p}}`).join(' -> ')}`,
    });
  }
  // a colour that resolved once resolves the same wherever it is reached from (a cycle through it would have failed it)
  const known = cx.memo.get(path);
  if (visiting.length + (known?.height ?? 1) > MAX_CHAIN)
    return err({ code: 'TOKEN_CYCLE', message: `the chain of links from {${visiting[0] ?? path}} in theme ${theme.name} is longer than ${MAX_CHAIN}` });
  if (known !== undefined) return ok(known);
  // the work is bounded as well as the depth: a theme whose links fan out (each token aliased to the next and mixed with it) would
  // otherwise be followed an exponential number of times
  if (cx.left-- <= 0)
    return err({ code: 'TOKEN_CYCLE', message: `theme ${theme.name} has more links to follow than the ${MAX_LINKS_PER_TOKEN} per token allowed` });
  const done = resolveToken_(cx, path, visiting);
  if (done.ok) cx.memo.set(path, done.value);
  return done;
}

/** The body of {@link resolve}: the token at `path` read, its base resolved and its steps applied. */
function resolveToken_(cx: Cx, path: string, visiting: readonly string[]): Result<Resolved, ThemeError> {
  const { theme } = cx;
  const node = nodeAt(theme.tokens, path);
  if (node === undefined) return err({ code: 'TOKEN_UNKNOWN', message: `theme ${theme.name} has no token {${path}}` });
  if (!isToken(node) || node.$type !== 'color') return err({ code: 'TOKEN_TYPE', message: `{${path}} of theme ${theme.name} is not a colour token` });
  // every link must be a valid colour token itself: a theme object that never went through `themeSchema` cannot make a link carry
  // a string that is not a colour into CSS (M4.10 review round 2 F1)
  if (!isValidToken(node)) return err({ code: 'TOKEN_TYPE', message: `{${path}} of theme ${theme.name} is not a valid colour token` });
  const steps = readSteps(theme, path, rawSteps(node));
  if (!steps.ok) return steps;
  const chain = [...visiting, path];
  const base: Result<Resolved, ThemeError> = TOKEN_REF.test(node.$value) ? resolve(cx, node.$value.slice(1, -1), chain) : ok({ css: node.$value, height: 0 });
  if (!base.ok) return base;
  if (steps.value.length === 0) return ok({ css: base.value.css, height: base.value.height + 1 });
  const derived = derive({ cx, path, chain }, base.value.css, steps.value);
  return derived.ok ? ok({ css: derived.value.css, height: Math.max(base.value.height, derived.value.height) + 1 }) : derived;
}

/** Where a derivation is: the resolver, the token and the links followed to it. */
type Link = { readonly cx: Cx; readonly path: string; readonly chain: readonly string[] };

/** `from`, a colour as CSS text, changed by `steps`; `mix` partners are resolved as further links of `chain`. */
function derive(at: Link, from: string, steps: readonly Step[]): Result<Resolved, ThemeError> {
  const { cx, path } = at;
  const start = parseColor(from);
  if (start === undefined) return err(badStep(cx.theme, path, `${from} cannot be derived from (use hex, rgb, hsl, oklch or oklab)`));
  const derived: ColorStep[] = [];
  let height = 0;
  for (const step of steps) {
    const next = colorStep(at, step);
    if (!next.ok) return next;
    derived.push(next.value.step);
    height = Math.max(height, next.value.height);
  }
  return ok({ css: oklchToCss(deriveOklch(start, derived)), height });
}

/** One step as the maths takes it: a `mix` partner is resolved and parsed here. */
function colorStep({ cx, path, chain }: Link, step: Step): Result<{ readonly step: ColorStep; readonly height: number }, ThemeError> {
  if (step.op !== 'mix')
    return ok({ step: step.op === 'lighten' ? { lighten: step.n } : step.op === 'darken' ? { darken: step.n } : { alpha: step.n }, height: 0 });
  const other = resolve(cx, step.with.slice(1, -1), chain);
  if (!other.ok) return other;
  const color = parseColor(other.value.css);
  if (color === undefined) return err(badStep(cx.theme, path, `${other.value.css} cannot be mixed (use hex, rgb, hsl, oklch or oklab)`));
  return ok({ step: { mix: { with: color, amount: step.amount } }, height: other.value.height });
}

/**
 * A resolver of colour tokens for one theme: `(path) => the colour as CSS text`, following aliases and applying transform steps
 * (ADR-0152). Calls share what they have resolved and a budget of links to follow (a few per token), so resolving every token
 * of a theme is linear in its size whatever its links look like. TOKEN_UNKNOWN when a link names no token, TOKEN_TYPE when one
 * is not a (valid) colour token, TOKEN_CYCLE when the links return to a token already visited or there are too many to follow,
 * TOKEN_TRANSFORM when a step is malformed or out of range or a colour cannot be derived from.
 *
 * @public
 */
export type ColorResolver = (path: string) => Result<string, ThemeError>;

/** Links a resolver may follow per token of the theme (and at least 4096 in all). */
const MAX_LINKS_PER_TOKEN = 16;

/**
 * The colour resolver of `theme`: one per batch of lookups (a CSS-variable emission, a validation, a style resolution).
 *
 * @public
 */
export function colorResolver(theme: Theme): ColorResolver {
  const cx: Cx = { theme, memo: new Map(), left: Math.max(4096, MAX_LINKS_PER_TOKEN * tokenEntries(theme.tokens).length) };
  return (path) => {
    const r = resolve(cx, path, []);
    return r.ok ? ok(r.value.css) : r;
  };
}

/**
 * The literal colour the colour token at `path` resolves to: an alias followed to its end, then the token's transform steps in
 * order (a derived token); a literal colour with no transform comes back as written. TOKEN_UNKNOWN when a link names no token,
 * TOKEN_TYPE when one is not a (valid) colour token, TOKEN_CYCLE when the links return to a token already visited,
 * TOKEN_TRANSFORM when a step is malformed or out of range or a colour cannot be derived from.
 *
 * @public
 */
export function followColor(theme: Theme, path: string): Result<string, ThemeError> {
  return colorResolver(theme)(path);
}
