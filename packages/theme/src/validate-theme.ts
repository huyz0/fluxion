// Theme validation (FR-THM-001, ADR-0152): the schema's refusals plus the checks a schema cannot make: the required colour
// roles, the type of each token group, and aliases that name nothing or run in a circle. Every problem carries a JSON pointer
// into the theme. Pure.
import { DIAGNOSTIC_CODES, type Diagnostic, type DiagnosticCode, jsonPointer } from '@fluxion/schema';
import { colorResolver, needsResolving } from './alias.js';
import type { ThemeErrorCode } from './errors.js';
import { isToken, nodeAt, type Theme, themeSchema, tokenEntries } from './tokens.js';

/**
 * The colour roles every theme defines (FR-THM-001).
 *
 * @public
 */
export const REQUIRED_COLOR_ROLES: readonly string[] = [
  'background',
  'surface',
  'text',
  'muted',
  'primary',
  'secondary',
  'accent-1',
  'accent-2',
  'accent-3',
  'accent-4',
  'accent-5',
  'accent-6',
  'success',
  'warning',
  'danger',
  'info',
  'connector',
];

/**
 * One problem of a theme: a stable code, where it is (a JSON pointer into the theme) and a one-line message.
 *
 * @public
 */
export type ThemeProblem = {
  /** What is wrong. */
  readonly code: ThemeErrorCode;
  /** The JSON pointer of the offending value in the theme, e.g. `/tokens/color/primary`. */
  readonly path: string;
  /** A one-line developer message. */
  readonly message: string;
};

/** The DTCG type each token group holds, by path prefix: a token under a prefix of another type is a problem. */
const GROUP_TYPES: ReadonlyArray<readonly [prefix: string, type: string]> = [
  ['color.', 'color'],
  ['font.size.', 'dimension'],
  ['font.weight.', 'fontWeight'],
  ['font.line-height.', 'number'],
  ['space.', 'dimension'],
  ['radius.', 'dimension'],
  ['stroke.', 'dimension'],
  ['shadow.', 'shadow'],
  ['motion.duration.', 'duration'],
  ['motion.easing.', 'cubicBezier'],
];
const FONT_FAMILIES = new Set(['font.heading', 'font.body', 'font.mono']);

const pointer = (path: string, ...rest: string[]) => jsonPointer(['tokens', ...path.split('.'), ...rest]);

/** The missing or mistyped colour roles of `t`. */
function roleProblems(t: Theme): ThemeProblem[] {
  const out: ThemeProblem[] = [];
  for (const role of REQUIRED_COLOR_ROLES) {
    const node = nodeAt(t.tokens, `color.${role}`);
    if (node === undefined) out.push({ code: 'ROLE_MISSING', path: pointer(`color.${role}`), message: `theme ${t.name} has no colour role ${role}` });
    else if (!isToken(node)) out.push({ code: 'TOKEN_TYPE', path: pointer(`color.${role}`), message: `color.${role} is a group, not a colour token` });
  }
  return out;
}

/** The type a token at `path` must have, from its group, or undefined when the path is in no typed group. */
const expectedType = (path: string): string | undefined =>
  GROUP_TYPES.find(([prefix]) => path.startsWith(prefix))?.[1] ?? (FONT_FAMILIES.has(path) ? 'fontFamily' : undefined);

/** The wrong-typed tokens and the broken aliases of `t`. */
function tokenProblems(t: Theme): ThemeProblem[] {
  const out: ThemeProblem[] = [];
  const follow = colorResolver(t);
  for (const [path, token] of tokenEntries(t.tokens)) {
    const expected = expectedType(path);
    if (expected !== undefined && token.$type !== expected) {
      out.push({ code: 'TOKEN_TYPE', path: pointer(path, '$type'), message: `${path} is ${token.$type}; this group holds ${expected} tokens` });
    } else if (needsResolving(token)) {
      const followed = follow(path);
      if (!followed.ok) out.push({ code: followed.error.code, path: pointer(path, '$value'), message: followed.error.message });
    }
  }
  return out;
}

/**
 * Every problem of `theme`: the schema's refusals, a missing colour role, a token of the wrong type for its group, and an
 * alias that names no token, a token that is not a colour, or itself in a circle. Empty when the theme is sound.
 *
 * @public
 */
export function validateTheme(theme: unknown): readonly ThemeProblem[] {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ code: 'THEME_INVALID' as const, path: jsonPointer(i.path.map(String)), message: i.message }));
  }
  return [...roleProblems(parsed.data), ...tokenProblems(parsed.data)];
}

/** The diagnostic code of a theme problem: the catalogued code a problem of that kind has, else FLX_SCHEMA_INVALID. */
const DIAGNOSTIC_OF: { readonly [C in ThemeErrorCode]?: DiagnosticCode } = {
  TOKEN_UNKNOWN: 'FLX_TOKEN_UNKNOWN',
  TOKEN_CYCLE: 'FLX_TOKEN_CYCLE',
  TOKEN_TRANSFORM: 'FLX_TOKEN_TRANSFORM',
};

/**
 * The problems of `theme` as diagnostics of the catalogue (a host that validates a document's themes reports these): a cycle is
 * FLX_TOKEN_CYCLE, a malformed step FLX_TOKEN_TRANSFORM, an alias to nothing FLX_TOKEN_UNKNOWN, any other problem
 * FLX_SCHEMA_INVALID; each with the path into the theme.
 *
 * @public
 */
export function themeDiagnostics(theme: unknown): readonly Diagnostic[] {
  return validateTheme(theme).map((p) => {
    const code = DIAGNOSTIC_OF[p.code] ?? 'FLX_SCHEMA_INVALID';
    return { code, severity: DIAGNOSTIC_CODES[code], path: p.path, message: p.message };
  });
}
