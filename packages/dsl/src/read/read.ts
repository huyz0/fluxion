// Read stage (ADR-0030, FR-DSL-001/002/006): the parsed tree checked against the `flux: 1` key table and turned into a typed, located
// tree. Unknown keys are `FLX_DSL_UNKNOWN_KEY` with the nearest valid key; sections R2 does not compile are `FLX_DSL_NOT_YET` warnings and
// keep their source text by pointer; slugs and screen ids follow the slug rule; edges go through the edge tokenizer.
import { edgeDiagnostic, parseEdge, parseEdgeObject } from '../parse/edge.js';
import { isYMap, isYScalar, isYSeq, type YEntry, type YMap, type YNode } from '../parse/parse.js';
import { nearest } from '../resolve/suggest.js';
import type { DslDiagnostic } from '../types.js';
import type { EdgeAst, FluxAst, GroupAst, Located, NodeAst, ScreenAst } from './ast.js';
import { asMap, type Ctx, entries, KEYS, layout, pin, report, slug, stringList, style, text, textOf } from './fields.js';

/** Content keys: a node that has none of them after deferral has nothing to draw and is deferred whole (ADR-0030 review r2 F1). */
const CONTENT = ['shape', 'text', 'label'];

/** Report the keys of `m` the table has neither compiled nor deferred (a node kept whole still has its typos found). */
function unknownKeys(ctx: Ctx, m: YMap, table: { readonly compiled: readonly string[]; readonly deferred: readonly string[] }, path: string): void {
  const known = [...table.compiled, ...table.deferred];
  for (const e of m.entries.filter((x) => !known.includes(x.key))) {
    const near = nearest(e.key, known);
    report(ctx, {
      code: 'FLX_DSL_UNKNOWN_KEY',
      range: e.keyRange,
      path: `${path}/${e.key}`,
      message: `"${e.key}" is not a key here`,
      hint: near ? `did you mean "${near}"?` : `keys here: ${table.compiled.join(', ')}`,
    });
  }
}

function node(ctx: Ctx, e: YEntry, path: string, pointer: string): NodeAst | undefined {
  const at = `${path}/${e.key}`;
  if (!slug(ctx, e.key, e.keyRange, at)) return undefined;
  const m = asMap(ctx, e.value, at, `node "${e.key}"`);
  if (!m) return undefined;
  if (!m.entries.some((x) => CONTENT.includes(x.key))) {
    if (m.entries.some((x) => (KEYS.node.deferred as readonly string[]).includes(x.key))) {
      unknownKeys(ctx, m, KEYS.node, at);
      // nothing R2 can draw (e.g. a component with props): kept whole, with one warning
      ctx.deferred[`${pointer}/${e.key}`] = textOf(ctx, m);
      report(ctx, {
        code: 'FLX_DSL_NOT_YET',
        range: e.keyRange,
        path: at,
        message: `node "${e.key}" has no shape, text or label R2 can draw: kept but not compiled yet`,
        severity: 'warning',
      });
      return undefined;
    }
    // unknown keys are still reported (a misspelt `shap`), then the missing content
    const before = ctx.diagnostics.length;
    entries(ctx, m, KEYS.node, { path: at, pointer: `${pointer}/${e.key}` });
    if (ctx.diagnostics.length === before)
      report(ctx, {
        code: 'FLX_SCHEMA_INVALID',
        range: e.keyRange,
        path: at,
        message: `node "${e.key}" has no shape, text or label`,
        hint: `${e.key}: { shape: rect, label: … }`,
      });
    return undefined;
  }
  const f = entries(ctx, m, KEYS.node, { path: at, pointer: `${pointer}/${e.key}` });
  const located = { slug: { value: e.key, range: e.keyRange } };
  const fields = Object.fromEntries(
    (['shape', 'text', 'label', 'tone', 'alt'] as const).flatMap((k) => {
      const v = text(ctx, f.get(k), at);
      return v ? [[k, v]] : [];
    }),
  );
  const st = style(ctx, f.get('style'), at);
  const pn = pin(ctx, f.get('pin'), at);
  return { ...located, ...fields, ...(st ? { style: st } : {}), ...(pn ? { pin: pn } : {}) };
}

function group(ctx: Ctx, e: YEntry, path: string): GroupAst | undefined {
  const at = `${path}/${e.key}`;
  if (!slug(ctx, e.key, e.keyRange, at)) return undefined;
  const m = asMap(ctx, e.value, at, `group "${e.key}"`);
  if (!m) return undefined;
  const f = entries(ctx, m, KEYS.group, { path: at, pointer: '' });
  const contains = stringList(ctx, f.get('contains')?.value, `${at}/contains`, 'contains: [api, db]');
  const label = text(ctx, f.get('label'), at);
  const st = style(ctx, f.get('style'), at);
  const lay = layout(ctx, f.get('layout'), at);
  return { slug: { value: e.key, range: e.keyRange }, contains, ...(label ? { label } : {}), ...(st ? { style: st } : {}), ...(lay ? { layout: lay } : {}) };
}

/** An edge entry: `- a -> b`, `- a -> b: label`, `- a -> b: { label, style, route }`, or the object form. */
function edge(ctx: Ctx, item: YNode, path: string, pointer: string): EdgeAst | undefined {
  if (isYScalar(item) && typeof item.value === 'string') return fromShorthand(ctx, { key: item.value, range: item.range }, { path, pointer });
  if (!isYMap(item)) {
    report(ctx, { code: 'FLX_DSL_EDGE_SYNTAX', range: item.range, path, message: 'an edge is `a -> b`, `a -> b: label` or { from, to }' });
    return undefined;
  }
  const first = item.entries[0];
  if (item.entries.length === 1 && first && !KEYS.edge.compiled.includes(first.key as never))
    return fromShorthand(ctx, { key: first.key, range: first.keyRange, value: first.value }, { path, pointer });
  return fromObject(ctx, item, path, pointer);
}

function details(ctx: Ctx, value: YNode | undefined, path: string, pointer: string): Pick<EdgeAst, 'label' | 'style' | 'route'> {
  if (value === undefined || (isYScalar(value) && value.value === null)) return {};
  if (isYScalar(value)) return { label: { value: String(value.value), range: value.range } };
  const m = asMap(ctx, value, path, 'an edge value');
  if (!m) return {};
  const f = entries(ctx, m, { compiled: ['label', 'style', 'route'], deferred: KEYS.edge.deferred }, { path: path, pointer: pointer });
  return attributes(ctx, f, path);
}

function attributes(ctx: Ctx, f: Map<string, YEntry>, path: string): Pick<EdgeAst, 'label' | 'style' | 'route'> {
  const label = text(ctx, f.get('label'), path);
  const st = style(ctx, f.get('style'), path);
  const r = text(ctx, f.get('route'), path);
  const routes = ['straight', 'curved', 'orthogonal', 'polyline'];
  if (r && !routes.includes(r.value))
    report(ctx, {
      code: 'FLX_SCHEMA_INVALID',
      range: r.range,
      path: `${path}/route`,
      message: `"${r.value}" is not a route`,
      hint: `one of ${routes.join(', ')}`,
    });
  const route = r && routes.includes(r.value) ? { route: r as EdgeAst['route'] & object } : {};
  return { ...(label ? { label } : {}), ...(st ? { style: st } : {}), ...route };
}

type Shorthand = { readonly key: string; readonly range: YNode['range']; readonly value?: YNode | undefined };

function fromShorthand(ctx: Ctx, { key, range, value }: Shorthand, { path, pointer }: { path: string; pointer: string }): EdgeAst | undefined {
  const r = parseEdge(key);
  if (!r.ok) {
    ctx.diagnostics.push(edgeDiagnostic(r, range, path));
    return undefined;
  }
  return { edge: r.edge, range, ...details(ctx, value, path, pointer) };
}

function fromObject(ctx: Ctx, m: YMap, path: string, pointer: string): EdgeAst | undefined {
  const f = entries(ctx, m, KEYS.edge, { path: path, pointer: pointer });
  const raw = (k: string) => {
    const v = f.get(k)?.value;
    return isYScalar(v) ? v.value : v === undefined ? undefined : null;
  };
  const r = parseEdgeObject({ from: raw('from'), to: raw('to'), op: raw('op') ?? undefined });
  if (!r.ok) {
    const where = (r.field && f.get(r.field)?.value.range) || m.range;
    ctx.diagnostics.push(edgeDiagnostic(r, where, r.field ? `${path}/${r.field}` : path));
    return undefined;
  }
  return { edge: r.edge, range: m.range, ...attributes(ctx, f, path) };
}

function list<T>(ctx: Ctx, e: YEntry | undefined, path: string, each: (entry: YEntry) => T | undefined): T[] {
  const m = e && asMap(ctx, e.value, `${path}/${e.key}`, e.key);
  return m ? m.entries.flatMap((x) => each(x) ?? []) : [];
}

function screen(ctx: Ctx, item: YNode, index: number): ScreenAst | undefined {
  const path = `/screens/${index}`;
  const m = asMap(ctx, item, path, 'a screen');
  if (!m) return undefined;
  const id = text(
    ctx,
    m.entries.find((x) => x.key === 'id'),
    path,
  );
  if (!id) {
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: m.range, path: `${path}/id`, message: 'a screen needs an id', hint: '- id: intro' });
    return undefined;
  }
  if (!slug(ctx, id.value, id.range, `${path}/id`)) return undefined;
  const pointer = `/screens/${id.value}`;
  const kind = m.entries.find((x) => x.key === 'kind');
  if (kind) {
    // an archetype: every key but id is its argument, kept together with kind (ADR-0030)
    ctx.deferred[`${pointer}/kind`] = textOf(ctx, m);
    report(ctx, {
      code: 'FLX_DSL_NOT_YET',
      range: kind.keyRange,
      path: `${path}/kind`,
      message: 'screen archetypes (kind) are kept but not compiled yet',
      severity: 'warning',
    });
    return { id, nodes: [], groups: [], edges: [], range: m.range };
  }
  const f = entries(ctx, m, KEYS.screen, { path: path, pointer: pointer });
  const title = text(ctx, f.get('title'), path);
  const background = text(ctx, f.get('background'), path);
  const notes = text(ctx, f.get('notes'), path);
  const lay = layout(ctx, f.get('layout'), path);
  const edgesNode = f.get('edges')?.value;
  if (edgesNode && !isYSeq(edgesNode))
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: edgesNode.range, path: `${path}/edges`, message: 'edges is a list', hint: '- web -> api' });
  const edges = isYSeq(edgesNode) ? edgesNode.items.flatMap((x, i) => edge(ctx, x, `${path}/edges/${i}`, `${pointer}/edges/${i}`) ?? []) : [];
  return {
    id,
    nodes: list(ctx, f.get('nodes'), path, (x) => node(ctx, x, `${path}/nodes`, `${pointer}/nodes`)),
    groups: list(ctx, f.get('groups'), path, (x) => group(ctx, x, `${path}/groups`)),
    edges,
    range: m.range,
    ...(title ? { title } : {}),
    ...(background ? { background } : {}),
    ...(notes ? { notes } : {}),
    ...(lay ? { layout: lay } : {}),
  };
}

/** Token overrides: string or number values by token name; anything else is an error. */
function tokens(ctx: Ctx, o: YNode | undefined): { [token: string]: string | number } {
  if (o === undefined) return {};
  if (!isYMap(o)) {
    report(ctx, {
      code: 'FLX_SCHEMA_INVALID',
      range: o.range,
      path: '/theme/overrides',
      message: 'overrides are token values by token name',
      hint: 'overrides: { color.accent: "#7C5CFF" }',
    });
    return {};
  }
  const out: { [token: string]: string | number } = {};
  for (const x of o.entries) {
    const v = isYScalar(x.value) ? x.value.value : null;
    if (typeof v === 'string' || typeof v === 'number') out[x.key] = v;
    else report(ctx, { code: 'FLX_SCHEMA_INVALID', range: x.value.range, path: `/theme/overrides/${x.key}`, message: `${x.key} must be a token value` });
  }
  return out;
}

function theme(ctx: Ctx, e: YEntry | undefined): FluxAst['theme'] {
  if (!e) return undefined;
  if (isYScalar(e.value) && typeof e.value.value === 'string') return { name: { value: e.value.value, range: e.value.range }, overrides: {} };
  const m = asMap(ctx, e.value, '/theme', 'theme');
  if (!m) return undefined;
  const f = entries(ctx, m, KEYS.theme, { path: '/theme', pointer: '/theme' });
  const name = text(ctx, f.get('preset') ?? f.get('name'), '/theme');
  return { ...(name ? { name } : {}), overrides: tokens(ctx, f.get('overrides')?.value) };
}

/**
 * What the read stage gives back: the tree (absent when the file is not a FluxScript mapping or has no valid version) and the problems.
 *
 * @public
 */
export type ReadResult = {
  /** The typed tree. */
  readonly ast?: FluxAst;
  /** Problems found reading. */
  readonly diagnostics: readonly DslDiagnostic[];
};

/**
 * Read the parsed tree of a FluxScript file (`text` is its source, for kept sections) against the `flux: 1` key table.
 *
 * @public
 */
export function readFlux(root: YNode, text: string): ReadResult {
  const ctx: Ctx = { text, diagnostics: [], deferred: {} };
  const top = asMap(ctx, root, '', 'a FluxScript file');
  if (!top) return { diagnostics: ctx.diagnostics };
  const f = entries(ctx, top, KEYS.top, { path: '', pointer: '' });
  const flux = f.get('flux')?.value;
  if (!(isYScalar(flux) && flux.value === 1)) {
    report(ctx, {
      code: 'FLX_DSL_VERSION',
      range: flux?.range ?? top.range,
      path: '/flux',
      message: flux ? 'flux must be 1' : 'the file has no flux version',
      hint: 'start the file with `flux: 1`',
    });
    return { diagnostics: ctx.diagnostics };
  }
  const uses = f.get('uses')?.value;
  const screensNode = f.get('screens')?.value;
  if (!screensNode || !isYSeq(screensNode))
    report(ctx, {
      code: 'FLX_SCHEMA_INVALID',
      range: screensNode?.range ?? top.range,
      path: '/screens',
      message: 'the file needs a list of screens',
      hint: 'screens:\n  - id: intro',
    });
  if (!f.has('title'))
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: top.range, path: '/title', message: 'the file needs a title', hint: 'title: How checkout works' });
  const titleText = (title: Located<string> | undefined) => (title ? { title } : {});
  const ast: FluxAst = {
    ...titleText(textField(ctx, f.get('title'))),
    ...themeField(theme(ctx, f.get('theme'))),
    uses: stringList(ctx, uses, '/uses', 'uses: [basic, flowchart]'),
    screens: isYSeq(screensNode) ? screensNode.items.flatMap((s, i) => screen(ctx, s, i) ?? []) : [],
    deferred: ctx.deferred,
  };
  return { ast, diagnostics: ctx.diagnostics };
}

const textField = (ctx: Ctx, e: YEntry | undefined) => text(ctx, e, '');
const themeField = (t: FluxAst['theme']) => (t ? { theme: t } : {});
