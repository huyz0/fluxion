// Expand and style stages (06-ai-authoring.md §3, ADR-0030, ADR-0031, FR-DSL-002): the resolved tree to document records. Meta is the
// document record (title, theme, `source` with the salt and the deferred sections), the theme is a theme record with its overrides
// applied, screens are screen records (keeping their source id in `meta.slug`, for the decompiler: the record id is a hash of it), nodes
// are shape or text elements, groups are group elements their members name as parent, and edges are connectors with two bindings. Ids are
// stable ids of the ADR-0031 keys. Placement is the place stage's (M12.13): elements get their shape's default size at the origin, or
// their pin.
import { type CoreRegistries, type EdgeKey, idKeys, type SyncHash128, sha256Hash128, stableId } from '@fluxion/core';
import { type AnyRecord, DIAGNOSTIC_CODES, type LayoutSpec, nKeysBetween, type RecordId, type RichTextDoc, type Transform } from '@fluxion/schema';
import { isToken, isValidToken, type Theme, type Token, type TokenGroup } from '@fluxion/theme';
import type { EdgeAst, FluxAst, GroupAst, LayoutAst, NodeAst, ScreenAst } from '../read/ast.js';
import type { Resolution } from '../resolve/resolve.js';
import type { DslDiagnostic, SourceRange } from '../types.js';
import { anchorOf, opStyle, paintOf, styleOf } from './style.js';

/**
 * How to expand: the id salt and hash, and the registries shape default sizes come from.
 *
 * @public
 */
export type ExpandOptions = {
  /** The id salt (ADR-0031); the empty string when omitted. */
  readonly salt?: string;
  /** The stable-id hash; the SHA-256 one when omitted. */
  readonly hasher?: SyncHash128;
  /** Where shape default sizes are looked up; without it, or for a shape without one, a node is 160 × 80. */
  readonly registries?: CoreRegistries;
};

/**
 * What {@link expandFlux} gives back.
 *
 * @public
 */
export type ExpandResult = {
  /** The records, keyed by id: a document of the current schema version once wrapped. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** Where each record came from, by id (the document and theme records only when the source names them). */
  readonly sourceMap: ReadonlyMap<RecordId, SourceRange>;
  /** Where each screen's and group's `layout` type came from, by record id (only those the source gives a layout). */
  readonly layoutSources: ReadonlyMap<RecordId, SourceRange>;
  /** Problems found expanding. */
  readonly diagnostics: readonly DslDiagnostic[];
};

/** The size of a node whose shape states none (ADR-0030: text is not measured in R2). */
export const DEFAULT_SIZE = { w: 160, h: 80 } as const;

type Rec = { [key: string]: unknown };
type Ctx = {
  readonly records: { [id: string]: AnyRecord };
  readonly sourceMap: Map<RecordId, SourceRange>;
  readonly layoutSources: Map<RecordId, SourceRange>;
  readonly diagnostics: DslDiagnostic[];
  readonly id: (key: string) => RecordId;
  readonly resolution: Resolution;
  readonly registries: CoreRegistries | undefined;
};

/** One element of a screen in z-order, waiting for its index among the siblings that share its parent. */
type Pending = { readonly record: Rec; readonly range: SourceRange };

function add(ctx: Ctx, record: Rec, range: SourceRange | undefined): void {
  const id = record['id'] as RecordId;
  ctx.records[id] = record as AnyRecord;
  if (range) ctx.sourceMap.set(id, range);
}

/** Text as a rich-text document: one paragraph per line, an empty line an empty paragraph. */
function richText(text: string): RichTextDoc {
  const paragraph = (line: string) => (line === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: line }] });
  return { type: 'doc', content: text.split(/\r?\n/).map(paragraph) };
}

function layoutOf(l: LayoutAst): LayoutSpec {
  return { type: l.type.value, ...(Object.keys(l.options).length > 0 ? { options: l.options } : {}) };
}

/** An override's value as the token's type wants it: a number, or `<n>px` and `<n>ms` text, for a dimension or a duration. */
function overrideValue(t: Token, value: string | number): unknown {
  const unit = t.$type === 'dimension' ? 'px' : t.$type === 'duration' ? 'ms' : undefined;
  if (unit === undefined) return value;
  const n = typeof value === 'number' ? value : value.endsWith(unit) ? Number(value.slice(0, -unit.length)) : Number.NaN;
  return Number.isFinite(n) ? { value: n, unit } : value;
}

/** The theme's tokens with the overrides set; an override the token's type refuses is a diagnostic at its key, and the token keeps its value. */
function withOverrides(ctx: Ctx, tokens: TokenGroup, ast: FluxAst): TokenGroup {
  const out = JSON.parse(JSON.stringify(tokens)) as { [key: string]: unknown };
  for (const [name, value] of Object.entries(ast.theme?.overrides ?? {})) {
    const token = name.split('.').reduce<unknown>((at, part) => (typeof at === 'object' && at !== null ? (at as Rec)[part] : undefined), out);
    // a name that is no token was reported by resolve
    if (!isToken(token as TokenGroup | undefined)) continue;
    const t = token as Token;
    const next = overrideValue(t, value);
    if (isValidToken({ ...t, $value: next })) (t as unknown as Rec)['$value'] = next;
    else
      ctx.diagnostics.push({
        code: 'FLX_SCHEMA_INVALID',
        severity: DIAGNOSTIC_CODES.FLX_SCHEMA_INVALID,
        path: `/theme/overrides/${name}`,
        message: `${JSON.stringify(value)} is not a ${t.$type} value for ${name}`,
        ...(ast.theme?.overrideKeys[name] ? { source: ast.theme.overrideKeys[name] } : {}),
      });
  }
  return out as TokenGroup;
}

function theme(ctx: Ctx, ast: FluxAst): RecordId {
  const t: Theme = ctx.resolution.theme;
  const id = ctx.id(idKeys.theme(t.name));
  const tokens = withOverrides(ctx, t.tokens, ast);
  add(ctx, { id, type: 'theme', name: t.name, tokens, ...(t.defaults ? { defaults: t.defaults } : {}) }, ast.theme?.name?.range);
  return id;
}

function meta(ctx: Ctx, ast: FluxAst, themeId: RecordId, salt: string): void {
  const record = {
    id: ctx.id(idKeys.document()),
    type: 'document',
    ...(ast.title ? { title: ast.title.value } : {}),
    themeId,
    source: { flux: 1, salt, deferred: { ...ast.deferred } },
  };
  add(ctx, record, ast.title?.range);
}

/** A node's box: its pin, else the origin; its size the pin's, else its shape's default, else the fixed default. */
function transformOf(ctx: Ctx, n: NodeAst, defId: string | undefined): Transform {
  const size = (defId && ctx.registries?.shapeDefs.get(defId)?.defaultSize) || DEFAULT_SIZE;
  const pin = n.pin?.value;
  return { x: pin?.x ?? 0, y: pin?.y ?? 0, w: pin?.w ?? size.w, h: pin?.h ?? size.h };
}

/** A node as a shape element (with a resolved shape) or a text element (text, or a label alone); an unresolved shape gives nothing. */
function node(ctx: Ctx, n: NodeAst, screenId: RecordId): Pending | undefined {
  const defId = ctx.resolution.shapes.get(n.slug.value);
  if (n.shape && !defId) return undefined;
  const content = n.text?.value ?? (defId ? n.label?.value : (n.label?.value ?? ''));
  const name = n.alt?.value ?? n.label?.value;
  const style = styleOf({ style: n.style, tone: n.tone?.value });
  const record: Rec = {
    id: ctx.id(idKeys.node(n.slug.value)),
    type: 'element',
    screenId,
    kind: defId ? 'shape' : 'text',
    ...(defId ? { defId } : {}),
    // alt is the accessible name; the label is the shown text
    semantic: { slug: n.slug.value, ...(name !== undefined ? { label: name } : {}) },
    ...(content !== undefined ? { text: richText(content) } : {}),
    ...(style ? { style } : {}),
    placement: n.pin ? 'pinned' : 'auto',
    transform: transformOf(ctx, n, defId),
  };
  return { record, range: n.slug.range };
}

function group(ctx: Ctx, g: GroupAst, screenId: RecordId): Pending {
  const style = styleOf({ style: g.style });
  if (g.layout) ctx.layoutSources.set(ctx.id(idKeys.node(g.slug.value)), g.layout.type.range);
  const record: Rec = {
    id: ctx.id(idKeys.node(g.slug.value)),
    type: 'element',
    screenId,
    kind: 'group',
    semantic: { slug: g.slug.value, ...(g.label ? { label: g.label.value } : {}) },
    ...(g.label ? { text: richText(g.label.value) } : {}),
    ...(style ? { style } : {}),
    ...(g.layout ? { layout: layoutOf(g.layout) } : {}),
    placement: 'auto',
    transform: { x: 0, y: 0, w: 0, h: 0 },
  };
  return { record, range: g.slug.range };
}

/** Whether putting `member` in `group` would make a group inside itself: `member` is `group` or one of the groups that hold it. */
function closesCycle(owner: ReadonlyMap<string, string>, group: string, member: string): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = group; at !== undefined && !seen.has(at); at = owner.get(at)) {
    if (at === member) return true;
    seen.add(at);
  }
  return false;
}

/** Members name their group as parent; a member already in a group, or one that would close a cycle, stays out, with a diagnostic. */
function parents(ctx: Ctx, s: ScreenAst, index: number, bySlug: ReadonlyMap<string, Pending>): void {
  const owner = new Map<string, string>();
  for (const g of s.groups) {
    const parent = bySlug.get(g.slug.value);
    g.contains.forEach((m, k) => {
      const child = bySlug.get(m.value);
      if (!child || !parent) return;
      const first = owner.get(m.value);
      if (first !== undefined || closesCycle(owner, g.slug.value, m.value)) {
        ctx.diagnostics.push({
          code: 'FLX_PARENT_INVALID',
          severity: DIAGNOSTIC_CODES.FLX_PARENT_INVALID,
          path: `/screens/${index}/groups/${g.slug.value}/contains/${k}`,
          message: first !== undefined ? `"${m.value}" is already in group "${first}"` : `group "${m.value}" cannot be inside itself`,
          hint: 'an element is in one group',
          source: m.range,
        });
        return;
      }
      owner.set(m.value, g.slug.value);
      child.record['parentId'] = parent.record['id'];
    });
  }
}

/** An edge (named by `key`) as a connector and its two bindings, keyed `<edge key>:source` and `:target`; an end that names no element of the
 * screen gives nothing (resolve reported it). */
function edge(ctx: Ctx, e: EdgeAst, key: EdgeKey, bySlug: ReadonlyMap<string, Pending>): Pending | undefined {
  const { from, op, to } = e.edge;
  const source = bySlug.get(from.slug)?.record['id'];
  const target = bySlug.get(to.slug)?.record['id'];
  if (source === undefined || target === undefined) return undefined;
  const id = ctx.id(idKeys.edge(key));
  const { markers, dashed } = opStyle(op);
  const style = styleOf({ style: e.style, dashed });
  const record: Rec = {
    id,
    type: 'element',
    screenId: ctx.id(idKeys.screen(key.screen)),
    kind: 'connector',
    route: { type: e.route?.value ?? 'straight' },
    markers,
    ...(e.label ? { labels: [{ text: richText(e.label.value), position: 0.5 }] } : {}),
    ...(style ? { style } : {}),
  };
  const ends = [
    ['source', source, from.anchor, e.ends.from],
    ['target', target, to.anchor, e.ends.to],
  ] as const;
  for (const [end, elementId, anchor, range] of ends)
    add(
      ctx,
      {
        id: ctx.id(`${idKeys.edge(key)}:${end}`),
        type: 'binding',
        connectorId: id,
        end,
        elementId,
        anchor: anchorOf(anchor),
      },
      range,
    );
  return { record, range: e.range };
}

/** Fractional indices in order, per sibling set (same parent). */
function assignIndices(ctx: Ctx, pending: readonly Pending[]): void {
  const sets = new Map<unknown, Pending[]>();
  for (const p of pending) sets.set(p.record['parentId'], [...(sets.get(p.record['parentId']) ?? []), p]);
  for (const list of sets.values()) {
    const keys = nKeysBetween(null, null, list.length);
    list.forEach((p, i) => {
      p.record['index'] = keys.ok ? keys.value[i] : undefined;
      add(ctx, p.record, p.range);
    });
  }
}

function screen(ctx: Ctx, s: ScreenAst, i: number, index: string | undefined): void {
  const screenId = ctx.id(idKeys.screen(s.id.value));
  if (s.layout) ctx.layoutSources.set(screenId, s.layout.type.range);
  add(
    ctx,
    {
      id: screenId,
      type: 'screen',
      index,
      // the source id, for the decompiler: the record id is a hash of it (ADR-0031)
      meta: { slug: s.id.value },
      ...(s.title ? { name: s.title.value } : {}),
      ...(s.layout ? { layout: layoutOf(s.layout) } : {}),
      ...(s.background ? { background: paintOf(s.background.value) } : {}),
      ...(s.notes ? { notes: richText(s.notes.value) } : {}),
    },
    s.range,
  );
  // z-order: groups behind, then nodes, then edges, each in source order
  const shapes = [...s.groups.map((g) => group(ctx, g, screenId)), ...s.nodes.flatMap((n) => node(ctx, n, screenId) ?? [])];
  const bySlug = new Map(shapes.map((p) => [(p.record['semantic'] as Rec)['slug'] as string, p]));
  parents(ctx, s, i, bySlug);
  const seen = new Map<string, number>();
  const edges = s.edges.flatMap((e) => {
    const key = `${e.edge.from.slug}\u0000${e.edge.op}\u0000${e.edge.to.slug}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return edge(ctx, e, { screen: s.id.value, from: e.edge.from.slug, op: e.edge.op, to: e.edge.to.slug, n }, bySlug) ?? [];
  });
  assignIndices(ctx, [...shapes, ...edges]);
}

/**
 * Expand a resolved FluxScript tree into document records (the expand and style stages): meta, theme, screens, nodes, groups and edges,
 * with stable ids (ADR-0031). Elements are not placed yet: each has its pin or its default size at the origin.
 *
 * @public
 */
export function expandFlux(ast: FluxAst, resolution: Resolution, options: ExpandOptions = {}): ExpandResult {
  const salt = options.salt ?? '';
  const hasher = options.hasher ?? sha256Hash128;
  const ctx: Ctx = {
    records: {},
    sourceMap: new Map(),
    layoutSources: new Map(),
    diagnostics: [],
    id: (key) => stableId(hasher, salt, key) as RecordId,
    resolution,
    registries: options.registries,
  };
  meta(ctx, ast, theme(ctx, ast), salt);
  const keys = nKeysBetween(null, null, ast.screens.length);
  ast.screens.forEach((s, i) => {
    screen(ctx, s, i, keys.ok ? keys.value[i] : undefined);
  });
  return { records: ctx.records, sourceMap: ctx.sourceMap, layoutSources: ctx.layoutSources, diagnostics: ctx.diagnostics };
}
