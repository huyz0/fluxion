// One screen as a FluxScript block (FR-DSL-002, ADR-0032): id, title, layout, background, nodes, groups, edges and notes, with the
// screen's deferred sections written back in place by pointer (ADR-0031). An element the v0 subset cannot write (an image, rich text
// with marks, a style the grammar cannot say, an edge to an element not written, a member of something that is not a written group) is
// left out and counted, and the block ends with `# kept: N records not shown`.
import { idKeys, stableId } from '@fluxion/core';
import type { AnchorRef, LayoutSpec, RecordId, Style } from '@fluxion/schema';
import { DEFAULT_SIZE } from '../expand/expand.js';
import type { EdgeOp } from '../parse/edge.js';
import { type Ctx, type El, type Rec, SLUGGED } from './context.js';
import type { Out, OutMap } from './emit.js';
import { anchorSuffix, fail, Inexpressible, layoutOut, paintOut, plainText, styleOut } from './values.js';

type Entry = readonly [string, Out];

/** A screen block, and how many of its elements it leaves out. */
export type ScreenOut = { readonly out: Out; readonly kept: number };

/** `read()`, or undefined when what it reads is outside the v0 subset. */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (e) {
    if (e instanceof Inexpressible) return undefined;
    throw e;
  }
}

/** The deferred sections under `prefix`, by the rest of their pointer. */
function under(ctx: Ctx, prefix: string): (readonly [string, string])[] {
  return ctx.deferred.flatMap(([p, t]) => (p.startsWith(`${prefix}/`) ? [[p.slice(prefix.length + 1), t] as const] : []));
}

const raws = (list: readonly (readonly [string, string])[]): Entry[] => list.map(([k, t]) => [k, { raw: t }] as const);

/** A shape's name as the file writes it: short when exactly one used pack has a shape of that name, else qualified. */
function shapeName(ctx: Ctx, defId: string): string {
  const short = defId.slice(defId.indexOf(':') + 1);
  if (short.includes(':')) return defId;
  const hits = ctx.uses.filter((p) => ctx.registries.shapeDefs.get(`${p}:${short}`) !== undefined);
  return hits.length === 1 && `${hits[0]}:${short}` === defId ? short : defId;
}

/** `text`, `label` and `alt` for shown text `t` and accessible name `n` (expand: text is `text ?? label`, the name `alt ?? label`). */
function textFields(t: string | undefined, n: string | undefined): Entry[] {
  if (t === undefined) return n === undefined ? [] : [['alt', n]];
  if (n === t) return [['label', t]];
  return n === undefined
    ? [['text', t]]
    : [
        ['label', t],
        ['alt', n],
      ];
}

/** A pinned element's box; its size only when it is not its shape's default. */
function pinOf(ctx: Ctx, el: El): Entry[] {
  if (el['placement'] !== 'pinned') return [];
  const t = el['transform'] as { readonly [k: string]: unknown } | undefined;
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => t?.[k]);
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) fail('pin');
  const defId = el['defId'];
  const size = (typeof defId === 'string' && ctx.registries.shapeDefs.get(defId)?.defaultSize) || DEFAULT_SIZE;
  const sized =
    w === size.w && h === size.h
      ? []
      : ([
          ['w', w as number],
          ['h', h as number],
        ] as const);
  return [['pin', { map: [['x', x as number], ['y', y as number], ...sized], flow: true }]];
}

const label = (el: El): string | undefined => {
  const l = el.semantic?.label;
  return l === undefined ? undefined : typeof l === 'string' ? l : fail('label');
};

/** A node's fields: a shape element (with its shape) or a text element (with its text). */
function nodeFields(ctx: Ctx, el: El, shaped: boolean): Entry[] {
  const defId = el['defId'];
  if (shaped !== (typeof defId === 'string')) fail('shape');
  const t = plainText(el['text'] as never);
  if (!shaped && t === undefined) fail('text');
  const { style, tone } = styleOut(el['style'] as Style | undefined, { tone: true, dashed: false });
  return [
    ...(shaped ? ([['shape', shapeName(ctx, defId as string)]] as const) : []),
    ...textFields(t, label(el)),
    ...(tone !== undefined ? ([['tone', tone]] as const) : []),
    ...(style !== undefined ? ([['style', style]] as const) : []),
    ...pinOf(ctx, el),
  ];
}

/** A group's own fields (its members are added once the written elements are known). */
function groupFields(_ctx: Ctx, el: El): Entry[] {
  const name = label(el) ?? plainText(el['text'] as never);
  const { style } = styleOut(el['style'] as Style | undefined, { tone: false, dashed: false });
  const layout = el['layout'] as LayoutSpec | undefined;
  return [
    ...(name !== undefined ? ([['label', name]] as const) : []),
    ...(style !== undefined ? ([['style', style]] as const) : []),
    ...(layout ? ([['layout', layoutOut(layout)]] as const) : []),
  ];
}

/** The reader of each kind FluxScript writes as a node or group. */
const READERS: { readonly [kind: string]: (ctx: Ctx, el: El) => Entry[] } = {
  shape: (ctx, el) => nodeFields(ctx, el, true),
  text: (ctx, el) => nodeFields(ctx, el, false),
  group: groupFields,
};
const GROUPS: ReadonlySet<string> = new Set(['group']);
const CONNECTORS: ReadonlySet<string> = new Set(['connector']);

/** The nodes and groups the block writes, with their fields: those the subset can write, whose parent (if any) is a written group. */
function written(ctx: Ctx, els: readonly El[]): Map<RecordId, Entry[]> {
  const out = new Map<RecordId, Entry[]>();
  for (const el of els) {
    const read = SLUGGED.has(el.kind) ? READERS[el.kind] : undefined;
    const fields = read && attempt(() => read(ctx, el));
    if (fields) out.set(el.id, fields);
  }
  prune(out, els);
  return out;
}

/** Drop from `out` every element whose parent is not a written group, until none is left. */
function prune(out: Map<RecordId, Entry[]>, els: readonly El[]): void {
  const isGroup = new Set(els.filter((el) => GROUPS.has(el.kind)).map((el) => el.id));
  const orphan = (el: El) => out.has(el.id) && el.parentId !== undefined && !(isGroup.has(el.parentId) && out.has(el.parentId));
  for (let left = els.filter(orphan); left.length > 0; left = els.filter(orphan)) for (const el of left) out.delete(el.id);
}

/** The ops whose markers these are (ADR-0030 op table). */
const OPS_BY_MARKERS: { readonly [markers: string]: readonly EdgeOp[] } = {
  'none/arrow': ['->', '~>'],
  'arrow/none': ['<-'],
  'arrow/arrow': ['<->'],
  'none/none': ['--'],
};
const ROUTES = new Set(['straight', 'curved', 'orthogonal', 'polyline']);

/** Where an edge is: its screen's id, how many edges of the screen join the same two ends, and the edge's deferred sections. */
type EdgeAt = { readonly sid: string; readonly count: number; readonly extras: readonly Entry[] };

/** The op of an edge between `fromSlug` and `toSlug`: the one whose ADR-0031 key gives its id, else the one its markers and dash say. */
function opOf(ctx: Ctx, el: El, [fromSlug, toSlug]: readonly [string, string], { sid, count }: EdgeAt): EdgeOp {
  const m = el['markers'] as { readonly start?: unknown; readonly end?: unknown } | undefined;
  const ops = OPS_BY_MARKERS[`${String(m?.start ?? 'none')}/${String(m?.end ?? 'none')}`] ?? fail('markers');
  for (const op of ops)
    for (let n = 1; n <= count; n++) if (stableId(ctx.hasher, ctx.salt, idKeys.edge({ screen: sid, from: fromSlug, op, to: toSlug, n })) === el.id) return op;
  const dash = (el['style'] as { readonly stroke?: { readonly dash?: unknown } } | undefined)?.stroke?.dash;
  return ops.includes('~>') && JSON.stringify(dash) === '[8,4]' ? '~>' : (ops[0] as EdgeOp);
}

/** An edge end: the slug of a written element and its anchor suffix. */
function endOf(binding: Rec | undefined, slugs: ReadonlyMap<RecordId, string>): readonly [string, string] {
  const slug = binding && slugs.get(binding['elementId'] as RecordId);
  if (slug === undefined) fail('edge end');
  return [slug, `${slug}${anchorSuffix(binding?.['anchor'] as AnchorRef | undefined)}`];
}

/** An edge's label: one label at the middle with plain text, or none. */
function edgeLabel(el: El): string | undefined {
  const labels = el['labels'] as readonly { readonly [k: string]: unknown }[] | undefined;
  if (labels === undefined || labels.length === 0) return undefined;
  const [only] = labels;
  if (labels.length > 1 || !only || only['position'] !== 0.5 || Object.keys(only).some((k) => k !== 'text' && k !== 'position')) fail('labels');
  return plainText(only['text'] as never);
}

function routeOf(el: El): string {
  const r = el['route'] as { readonly [k: string]: unknown } | undefined;
  if (r === undefined) return 'straight';
  if (Object.keys(r).some((k) => k !== 'type') || !ROUTES.has(String(r['type']))) fail('route');
  return String(r['type']);
}

/** One edge item: `a -> b`, `a -> b: label`, or `a -> b: { label, style, route, … }` with its deferred sections. */
function edgeItem(ctx: Ctx, el: El, at: EdgeAt): Out {
  const ends = ctx.bindings.get(el.id);
  const [fromSlug, from] = endOf(ends?.source, ctx.slugs);
  const [toSlug, to] = endOf(ends?.target, ctx.slugs);
  const op = opOf(ctx, el, [fromSlug, toSlug], at);
  const { style } = styleOut(el['style'] as Style | undefined, { tone: false, dashed: op === '~>' });
  const text = edgeLabel(el);
  const route = routeOf(el);
  const key = `${from} ${op} ${to}`;
  const details: Entry[] = [
    ...(text !== undefined ? ([['label', text]] as const) : []),
    ...(style !== undefined ? ([['style', style]] as const) : []),
    ...(route !== 'straight' ? ([['route', route]] as const) : []),
    ...at.extras,
  ];
  if (details.length === 0) return key;
  if (details.length === 1 && text !== undefined) return { map: [[key, text]] };
  return { map: [[key, { map: details, flow: true }]] };
}

/** The deferred sections of a screen: its own keys, whole kept nodes, node keys by slug, edge keys by position. */
type ScreenDeferred = {
  readonly own: (readonly [string, string])[];
  readonly nodes: (readonly [string, string])[];
  readonly nodeKeys: Map<string, Entry[]>;
  readonly edgeKeys: Map<string, Entry[]>;
};

/** File one deferred section of a screen (the rest of its pointer after `/screens/<id>/`) where it is written back. */
function file(d: ScreenDeferred, rest: string, text: string): void {
  const [head = '', at, key, ...more] = rest.split('/');
  if (more.length > 0) return;
  if (at === undefined) d.own.push([head, text]);
  else if (key === undefined) {
    if (head === 'nodes') d.nodes.push([at, text]);
  } else {
    const into = head === 'nodes' ? d.nodeKeys : d.edgeKeys;
    into.set(at, [...(into.get(at) ?? []), [key, { raw: text }]]);
  }
}

function deferredOf(ctx: Ctx, sid: string): ScreenDeferred {
  const d: ScreenDeferred = { own: [], nodes: [], nodeKeys: new Map(), edgeKeys: new Map() };
  for (const [rest, text] of under(ctx, `/screens/${sid}`)) file(d, rest, text);
  return d;
}

/** The nodes, groups and edges entries of a screen, and how many elements are left out. */
function body(ctx: Ctx, els: readonly El[], sid: string, d: ScreenDeferred): { readonly entries: Entry[]; readonly kept: number } {
  const fields = written(ctx, els);
  const slugOf = (el: El) => ctx.slugs.get(el.id) as string;
  const nodeEntry = (el: El): Entry => [slugOf(el), { map: [...(fields.get(el.id) ?? []), ...(d.nodeKeys.get(slugOf(el)) ?? [])], flow: true }];
  const members = (g: El) => els.filter((el) => el.parentId === g.id && fields.has(el.id)).map(slugOf);
  const groupEntry = (g: El): Entry => {
    const own = fields.get(g.id) ?? [];
    const list = members(g);
    const contains: Entry[] = list.length > 0 ? [['contains', { seq: list, flow: true }]] : [];
    // label first, then the members: `{ label: Backend, contains: [api, db], style: dashed }`
    const lead = own[0]?.[0] === 'label' ? 1 : 0;
    return [slugOf(g), { map: [...own.slice(0, lead), ...contains, ...own.slice(lead)], flow: true }];
  };
  const shown = els.filter((el) => fields.has(el.id));
  const groupEls = shown.filter((el) => GROUPS.has(el.kind));
  const nodeEls = shown.filter((el) => !GROUPS.has(el.kind));
  // nodes outside groups first, then each group's, each in z-order (only the order within a parent is in the document)
  const inOrder = [...nodeEls.filter((el) => el.parentId === undefined), ...groupEls.flatMap((g) => nodeEls.filter((el) => el.parentId === g.id))];
  const nodes = [...inOrder.map(nodeEntry), ...raws(d.nodes)];
  const groups = groupEls.map(groupEntry);
  const slugs = new Map([...ctx.slugs].filter(([id]) => fields.has(id)));
  const connectors = els.filter((el) => CONNECTORS.has(el.kind));
  // a repeat number counts the edges between the same two ends, so an edge's key is searched only up to that count (M12.16 review F1)
  const pair = (el: El) => {
    const ends = ctx.bindings.get(el.id);
    return `${String(ends?.source?.['elementId'])} ${String(ends?.target?.['elementId'])}`;
  };
  const between = new Map<string, number>();
  for (const el of connectors) between.set(pair(el), (between.get(pair(el)) ?? 0) + 1);
  const edges = connectors.flatMap(
    (el, i) => attempt(() => edgeItem({ ...ctx, slugs }, el, { sid, count: between.get(pair(el)) ?? 1, extras: d.edgeKeys.get(String(i)) ?? [] })) ?? [],
  );
  const entries: Entry[] = [
    ...(nodes.length > 0 ? ([['nodes', { map: nodes }]] as const) : []),
    ...(groups.length > 0 ? ([['groups', { map: groups }]] as const) : []),
    ...(edges.length > 0 ? ([['edges', { seq: edges }]] as const) : []),
  ];
  return { entries, kept: els.length - shown.length - edges.length };
}

/** A screen field the subset may not write: undefined then. */
const optional = <T>(read: () => T): T | undefined => attempt(read);

/** One screen as a block (a map item of `screens:`), or its archetype section as written (ADR-0030 `kind`). */
export function screenOut(ctx: Ctx, s: Rec): ScreenOut {
  const sid = ctx.screenIds.get(s.id) as string;
  const els = ctx.elements.get(s.id) ?? [];
  const archetype = ctx.deferred.find(([p]) => p === `/screens/${sid}/kind`);
  if (archetype) return { out: { raw: archetype[1] }, kept: els.length };
  const d = deferredOf(ctx, sid);
  const { entries, kept } = body(ctx, els, sid, d);
  const name = s['name'];
  const layout = s['layout'] === undefined ? undefined : optional(() => layoutOut(s['layout'] as LayoutSpec));
  const background = s['background'] === undefined ? undefined : optional(() => paintOut(s['background']));
  const notes = optional(() => plainText(s['notes'] as never));
  const map: Entry[] = [
    ['id', sid],
    ...(typeof name === 'string' ? ([['title', name]] as const) : []),
    ...(layout ? ([['layout', layout]] as const) : []),
    ...(background !== undefined ? ([['background', background]] as const) : []),
    ...entries,
    ...(notes !== undefined ? ([['notes', notes]] as const) : []),
    ...raws(d.own),
  ];
  const out: OutMap = { map, ...(kept > 0 ? { comments: [`kept: ${kept} records not shown`] } : {}) };
  return { out, kept };
}
