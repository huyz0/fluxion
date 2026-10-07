// Resolve stage (06-ai-authoring.md §3, ADR-0030, FR-DSL-006): the read tree checked against the host's registries. Packs in `uses:`
// must be registered; slugs and screen ids are unique; short shape names resolve through the used packs; edge ends and group members
// name a node or group of the same screen; the theme names a registered theme and style values that are token names name its tokens.
// Every miss comes with the nearest known name.
import type { CoreRegistries } from '@fluxion/core';
import { DIAGNOSTIC_CODES } from '@fluxion/schema';
import { isToken, LIGHT_THEME, type Theme, type TokenGroup, themeOf } from '@fluxion/theme';
import type { FluxAst, Located, LocatedStyle, NodeAst, ScreenAst } from '../read/ast.js';
import type { DslDiagnostic, SourceRange } from '../types.js';
import { nearest } from './suggest.js';

/**
 * What resolving decided: the theme, and the qualified shape of every node that names one.
 *
 * @public
 */
export type Resolution = {
  /** The theme the document uses: the one `theme:` names, else the built-in light theme. */
  readonly theme: Theme;
  /** The registry key of that theme, when it came from the registry. */
  readonly themeId?: string;
  /** The qualified shape id (`basic:rect`) of each node with a shape, by slug. */
  readonly shapes: ReadonlyMap<string, string>;
};

/**
 * The result of {@link resolveFlux}.
 *
 * @public
 */
export type ResolveResult = {
  /** What resolving decided; with errors, it holds what could be resolved. */
  readonly resolution: Resolution;
  /** Problems found resolving. */
  readonly diagnostics: readonly DslDiagnostic[];
};

type Ctx = { readonly diagnostics: DslDiagnostic[]; readonly registries: CoreRegistries };
type Problem = Omit<DslDiagnostic, 'severity' | 'source'> & { readonly at: Located<unknown> | { readonly range: DslDiagnostic['source'] & object } };

/** Report a problem; a schema code takes its schema severity, a FluxScript one is an error unless it is FLX_DSL_UNKNOWN_PACK. */
function report(ctx: Ctx, p: Problem): void {
  const shared = (DIAGNOSTIC_CODES as { readonly [code: string]: DslDiagnostic['severity'] })[p.code];
  const severity = shared ?? (p.code === 'FLX_DSL_UNKNOWN_PACK' ? 'warning' : 'error');
  const { at, ...rest } = p;
  ctx.diagnostics.push({ ...rest, severity, source: at.range });
}

const did = (name: string | undefined) => (name ? `did you mean "${name}"?` : undefined);
const withHint = (hint: string | undefined) => (hint ? { hint } : {});
const place = (l: Located<unknown>) => `line ${l.range.line}`;

/** The namespaces of everything registered: a pack is known when it registered a shape, a marker or a theme. */
function knownPacks(r: CoreRegistries): Set<string> {
  return new Set([...r.shapeDefs.list(), ...r.markers.list(), ...r.themes.list()].map(([key]) => key.split(':')[0] ?? key));
}

function checkUses(ctx: Ctx, ast: FluxAst): readonly string[] {
  const known = knownPacks(ctx.registries);
  for (const [i, u] of ast.uses.entries()) {
    if (!known.has(u.value))
      report(ctx, {
        code: 'FLX_DSL_UNKNOWN_PACK',
        at: u,
        path: `/uses/${i}`,
        message: `no pack "${u.value}" is registered`,
        ...withHint(did(nearest(u.value, [...known]))),
      });
  }
  // no `uses:` looks in every registered pack
  return ast.uses.length > 0 ? ast.uses.map((u) => u.value).filter((u) => known.has(u)) : [...known];
}

/** Every node and group slug once, every screen id once. */
function checkUnique(ctx: Ctx, ast: FluxAst): void {
  const screens = new Map<string, Located<string>>();
  const slugs = new Map<string, Located<string>>();
  ast.screens.forEach((s, i) => {
    const first = screens.get(s.id.value);
    if (first)
      report(ctx, {
        code: 'FLX_DSL_DUP_SLUG',
        at: s.id,
        path: `/screens/${i}/id`,
        message: `screen "${s.id.value}" is already used at ${place(first)}`,
        hint: 'give each screen its own id',
      });
    else screens.set(s.id.value, s.id);
    for (const [kind, list] of [
      ['nodes', s.nodes],
      ['groups', s.groups],
    ] as const) {
      for (const item of list) {
        const seen = slugs.get(item.slug.value);
        if (seen)
          report(ctx, {
            code: 'FLX_DSL_DUP_SLUG',
            at: item.slug,
            path: `/screens/${i}/${kind}/${item.slug.value}`,
            message: `"${item.slug.value}" is already used at ${place(seen)}`,
            hint: 'slugs are unique in the document',
          });
        else slugs.set(item.slug.value, item.slug);
      }
    }
  });
}

/** The qualified shape a node names, through the used packs, or a diagnostic. */
function shapeOf(ctx: Ctx, n: NodeAst, packs: readonly string[], path: string): string | undefined {
  const name = n.shape;
  if (!name) return undefined;
  const all = ctx.registries.shapeDefs.list().map(([key]) => key);
  if (name.value.includes(':')) {
    if (ctx.registries.shapeDefs.get(name.value)) return name.value;
    report(ctx, {
      code: 'FLX_DSL_UNKNOWN_SHAPE',
      at: name,
      path: `${path}/shape`,
      message: `no shape "${name.value}" is registered`,
      ...withHint(did(nearest(name.value, all))),
    });
    return undefined;
  }
  const found = packs.map((p) => `${p}:${name.value}`).filter((id) => ctx.registries.shapeDefs.get(id));
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    report(ctx, {
      code: 'FLX_DSL_AMBIGUOUS_SHAPE',
      at: name,
      path: `${path}/shape`,
      message: `"${name.value}" is a shape of ${found.length} used packs`,
      hint: `name one: ${found.join(', ')}`,
    });
    return undefined;
  }
  const short = all.filter((id) => packs.includes(id.split(':')[0] ?? '')).map((id) => id.slice(id.indexOf(':') + 1));
  report(ctx, {
    code: 'FLX_DSL_UNKNOWN_SHAPE',
    at: name,
    path: `${path}/shape`,
    message: `no used pack has a shape "${name.value}"`,
    ...withHint(did(nearest(name.value, short)) ?? (packs.length ? `packs used: ${packs.join(', ')}` : undefined)),
  });
  return undefined;
}

/** Edge ends and group members name a node or a group of this screen. */
function checkRefs(ctx: Ctx, s: ScreenAst, i: number, others: ReadonlyMap<string, string>): void {
  const here = [...s.nodes.map((n) => n.slug.value), ...s.groups.map((g) => g.slug.value)];
  const known = new Set(here);
  const missing = (ref: Located<string>, path: string, what: string) => {
    if (known.has(ref.value)) return;
    const elsewhere = others.get(ref.value);
    const hint = elsewhere ? `"${ref.value}" is on screen "${elsewhere}": edges and groups stay within a screen` : did(nearest(ref.value, here));
    report(ctx, {
      code: 'FLX_REF_MISSING',
      at: ref,
      path,
      message: `${what} "${ref.value}" is not a node or group of screen "${s.id.value}"`,
      ...withHint(hint),
    });
  };
  s.edges.forEach((e, k) => {
    for (const [end, field] of [
      [e.edge.from, 'from'],
      [e.edge.to, 'to'],
    ] as const) {
      missing({ value: end.slug, range: e.ends[field] }, `/screens/${i}/edges/${k}/${field}`, 'edge end');
    }
  });
  for (const g of s.groups) for (const m of g.contains) missing(m, `/screens/${i}/groups/${g.slug.value}/contains`, 'member');
}

/** The theme `theme:` names: by name or registry key; the built-in light theme when there is none. */
function themeFor(ctx: Ctx, ast: FluxAst): { readonly theme: Theme; readonly id?: string } {
  const name = ast.theme?.name;
  if (!name) return { theme: LIGHT_THEME };
  const entries = ctx.registries.themes.list().flatMap(([id, value]) => {
    const t = themeOf(value);
    return t ? [{ id, theme: t }] : [];
  });
  const hit = entries.find((e) => e.theme.name === name.value || e.id === name.value);
  if (hit) return { theme: hit.theme, id: hit.id };
  report(ctx, {
    code: 'FLX_REF_MISSING',
    at: name,
    path: '/theme',
    message: `no theme "${name.value}" is registered`,
    ...withHint(
      did(
        nearest(
          name.value,
          entries.map((e) => e.theme.name),
        ),
      ),
    ),
  });
  return { theme: LIGHT_THEME };
}

const TOKEN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** The dot path of every token of `group`. */
function tokenPaths(group: TokenGroup, prefix = ''): string[] {
  return Object.entries(group).flatMap(([name, node]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (isToken(node)) return [path];
    return typeof node === 'object' && node !== null ? tokenPaths(node as TokenGroup, path) : [];
  });
}

/** Style values and backgrounds that are token names, and override keys, name tokens of the theme. */
function checkTokens(ctx: Ctx, ast: FluxAst, theme: Theme): void {
  const tokens = tokenPaths(theme.tokens);
  const known = new Set(tokens);
  const unknown = (value: string, range: SourceRange, path: string) =>
    report(ctx, {
      code: 'FLX_TOKEN_UNKNOWN',
      at: { range },
      path,
      message: `theme ${theme.name} has no token ${value}`,
      ...withHint(did(nearest(value, tokens))),
    });
  // a value is a token reference only when it looks like one; an override key always names a token
  const check = (value: string, range: SourceRange, path: string) => {
    if (TOKEN.test(value) && !known.has(value)) unknown(value, range, path);
  };
  const styles = (style: LocatedStyle | undefined, path: string) => {
    if (style && typeof style.value === 'object')
      for (const [k, v] of Object.entries(style.value)) if (typeof v === 'string') check(v, style.entries?.[k] ?? style.range, `${path}/style/${k}`);
  };
  const keys = ast.theme?.overrideKeys ?? {};
  for (const [key, range] of Object.entries(keys)) if (!known.has(key)) unknown(key, range, `/theme/overrides/${key}`);
  ast.screens.forEach((s, i) => {
    if (s.background) check(s.background.value, s.background.range, `/screens/${i}/background`);
    for (const n of s.nodes) styles(n.style, `/screens/${i}/nodes/${n.slug.value}`);
    for (const g of s.groups) styles(g.style, `/screens/${i}/groups/${g.slug.value}`);
    s.edges.forEach((e, k) => {
      styles(e.style, `/screens/${i}/edges/${k}`);
    });
  });
}

/**
 * Resolve a read FluxScript tree against `registries`.
 *
 * @public
 */
export function resolveFlux(ast: FluxAst, registries: CoreRegistries): ResolveResult {
  const ctx: Ctx = { diagnostics: [], registries };
  const packs = checkUses(ctx, ast);
  checkUnique(ctx, ast);
  const screenOf = new Map(ast.screens.flatMap((s) => [...s.nodes, ...s.groups].map((x) => [x.slug.value, s.id.value] as const)));
  const shapes = new Map<string, string>();
  ast.screens.forEach((s, i) => {
    for (const n of s.nodes) {
      const id = shapeOf(ctx, n, packs, `/screens/${i}/nodes/${n.slug.value}`);
      if (id) shapes.set(n.slug.value, id);
    }
    checkRefs(ctx, s, i, screenOf);
  });
  const { theme, id } = themeFor(ctx, ast);
  checkTokens(ctx, ast, theme);
  return { resolution: { theme, shapes, ...(id ? { themeId: id } : {}) }, diagnostics: ctx.diagnostics };
}
