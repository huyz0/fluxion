// Lowering a resolved patch to records (ADR-0035): the ops run in order over a working copy of the document's records, so an op sees what the
// ones before it made, and the result is the set of records to put and delete. Nothing here writes a store: `ai.applyPatch` applies the result
// inside one transaction. Ids are the stable ids of ADR-0031 (a node by its slug, an edge by its key), so a patch and a compile of the
// same text make the same records.
import { type CoreRegistries, idKeys, type SyncHash128, stableId } from '@fluxion/core';
import { type AnyRecord, keyBetween, type RecordId, type RichTextDoc, type Style } from '@fluxion/schema';
import { anchorOf, opStyle, styleOf } from '../expand/style.js';
import type { LocatedStyle } from '../read/ast.js';
import type { ResolvedOp, ResolvedPatch, ResolvedRef } from './resolve-types.js';
import type { LayoutIntent, NodeSpec } from './schema.js';

/**
 * What lowering needs besides the patch.
 *
 * @public
 */
export type LowerContext = {
  /** The document's records, keyed by id. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** The id salt of the document (its `source.salt`). */
  readonly salt: string;
  /** The hash stable ids are made with. */
  readonly hasher: SyncHash128;
  /** Shape lookups: a shape name resolves to its registered id, and gives the element its default size. */
  readonly registries?: CoreRegistries;
};

/**
 * Where a lowered patch asks for a re-layout: a screen, or a group of it.
 *
 * @public
 */
export type Relayout = {
  /** The screen. */
  readonly screenId: string;
  /** The group whose children are laid out; absent for the screen's top level. */
  readonly containerId?: string;
};

/**
 * A resolved patch as record changes.
 *
 * @public
 */
export type Lowered = {
  /** The records to put (new or replaced), whole. */
  readonly puts: readonly AnyRecord[];
  /** The ids of the records to delete. */
  readonly deletes: readonly RecordId[];
  /** The containers the ops touched and wanted laid out again, each once. */
  readonly relayout: readonly Relayout[];
};

type Rec = { [key: string]: unknown };
type Tree = { [key: string]: unknown };

const DEFAULT_SIZE = { w: 160, h: 80 } as const;
const NO_BOX = { x: 0, y: 0, w: 0, h: 0 } as const;

/** Text as a rich-text document: one paragraph per line. */
function richText(text: string): RichTextDoc {
  const paragraph = (line: string) => (line === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: line }] });
  return { type: 'doc', content: text.split(/\r?\n/).map(paragraph) };
}

/** `over` merged into `base`, objects deeply, anything else replaced. */
function merge(base: Tree | undefined, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const at = out[key];
    const both = typeof value === 'object' && value !== null && !Array.isArray(value) && typeof at === 'object' && at !== null && !Array.isArray(at);
    out[key] = both ? merge(at as Tree, value as Tree) : value;
  }
  return out;
}

const styled = (style: { readonly [key: string]: string } | undefined, tone?: string): Style | undefined =>
  styleOf({ ...(style ? { style: { value: style } as unknown as LocatedStyle } : {}), ...(tone !== undefined ? { tone } : {}) });

class Lowering {
  readonly work = new Map<string, Rec>();
  readonly relayout = new Map<string, Relayout>();
  readonly #edges = new Map<string, string>();
  readonly #touched = new Set<string>();
  readonly ctx: LowerContext;
  readonly patch: ResolvedPatch;

  constructor(ctx: LowerContext, patch: ResolvedPatch) {
    this.ctx = ctx;
    this.patch = patch;
    for (const [id, record] of Object.entries(ctx.records)) this.work.set(id, record as Rec);
  }

  run(): Lowered {
    for (const op of this.patch.ops) this.apply(op);
    const puts = [...this.work.entries()].filter(([id, r]) => this.#touched.has(id) && r !== this.ctx.records[id]).map(([, r]) => r as AnyRecord);
    const deletes = [...this.#touched].filter((id) => !this.work.has(id) && this.ctx.records[id] !== undefined) as RecordId[];
    return { puts, deletes, relayout: [...this.relayout.values()] };
  }

  private put(record: Rec): void {
    const id = record['id'] as string;
    this.work.set(id, record);
    this.#touched.add(id);
  }

  private drop(id: string): void {
    this.work.delete(id);
    this.#touched.add(id);
  }

  private id(key: string): RecordId {
    return stableId(this.ctx.hasher, this.ctx.salt, key) as RecordId;
  }

  /** The id a reference stands for: a slug an earlier op added becomes its stable id. */
  private idOf(ref: ResolvedRef): string {
    if (!ref.id.startsWith('new:')) return ref.id;
    return this.#edges.get(ref.id) ?? this.id(idKeys.node(ref.id.slice(4)));
  }

  private rec(ref: ResolvedRef): Rec | undefined {
    return this.work.get(this.idOf(ref));
  }

  private slugOf(id: string): string {
    const semantic = this.work.get(id)?.['semantic'] as { slug?: string } | undefined;
    return semantic?.slug ?? id;
  }

  private ask(screenId: string, containerId?: string): void {
    this.relayout.set(`${screenId}/${containerId ?? ''}`, { screenId, ...(containerId ? { containerId } : {}) });
  }

  private apply(op: ResolvedOp): void {
    switch (op.op) {
      case 'add':
        this.add(op);
        break;
      case 'update':
        this.update(op);
        break;
      case 'remove':
        this.remove(op);
        break;
      case 'connect':
        this.connect(op);
        break;
      case 'disconnect':
        this.disconnect(op);
        break;
      case 'setLayout':
        this.setLayout(op);
        break;
      case 'restyle':
        this.restyle(op);
        break;
    }
  }

  /** The registered id of a shape name: as written, else the one pack that has it; undefined when there is none. */
  private shapeId(name: string): string | undefined {
    const defs = this.ctx.registries?.shapeDefs;
    if (!defs) return name;
    if (defs.get(name)) return name;
    const hits = defs.list().filter(([key]) => key.endsWith(`:${name}`));
    return hits.length === 1 ? hits[0]?.[0] : undefined;
  }

  private defaultSize(defId: string | undefined): { w: number; h: number } {
    return (defId && this.ctx.registries?.shapeDefs.get(defId)?.defaultSize) || DEFAULT_SIZE;
  }

  /** A fractional index after the last sibling of the same screen and parent. */
  private indexAfterLast(screenId: string, parentId: string | undefined): string {
    const last = [...this.work.values()]
      .filter((r) => r['type'] === 'element' && r['screenId'] === screenId && r['parentId'] === parentId && typeof r['index'] === 'string')
      .map((r) => r['index'] as string)
      .sort()
      .at(-1);
    const key = keyBetween(last ?? null, null);
    return key.ok ? key.value : 'a0';
  }

  /** The element record for an `add`. */
  private nodeRecord(op: Extract<ResolvedOp, { op: 'add' }>, screenId: string, parentId: string | undefined): Rec {
    const { node } = op;
    const defId = node.shape ? this.shapeId(node.shape) : undefined;
    return {
      id: this.id(idKeys.node(op.slug)),
      type: 'element',
      screenId,
      ...(parentId ? { parentId } : {}),
      kind: defId ? 'shape' : 'text',
      ...(defId ? { defId } : {}),
      index: this.indexAfterLast(screenId, parentId),
      ...this.content(op, defId),
      placement: node.pin ? 'pinned' : 'auto',
      transform: this.box(node.pin, defId),
    };
  }

  /** The semantic, text and style fields of a new element. */
  private content(op: Extract<ResolvedOp, { op: 'add' }>, defId: string | undefined): Rec {
    const { node } = op;
    const text = node.text ?? (defId ? node.label : (node.label ?? ''));
    const name = node.alt ?? node.label;
    const style = styled(node.style, node.tone);
    return {
      semantic: { slug: op.slug, ...(name !== undefined ? { label: name } : {}) },
      ...(text !== undefined ? { text: richText(text) } : {}),
      ...(style ? { style } : {}),
    };
  }

  /** The transform of a new element: its pin, else the shape's default size at the origin. */
  private box(pin: NodeSpec['pin'], defId: string | undefined): Rec {
    const size = this.defaultSize(defId);
    return { x: pin?.x ?? 0, y: pin?.y ?? 0, w: pin?.w ?? size.w, h: pin?.h ?? size.h };
  }

  private add(op: Extract<ResolvedOp, { op: 'add' }>): void {
    const screenId = this.idOf(op.screen);
    const parentId = op.parent ? this.idOf(op.parent) : undefined;
    this.put(this.nodeRecord(op, screenId, parentId));
    this.ask(screenId, parentId);
  }

  /** The fields of `spec` that change an existing element. */
  private changes(current: Rec, spec: NodeSpec): Rec {
    const out: Rec = {};
    const defId = spec.shape ? this.shapeId(spec.shape) : undefined;
    if (defId) Object.assign(out, { kind: 'shape', defId });
    const text = spec.text ?? spec.label;
    if (text !== undefined) out['text'] = richText(text);
    const name = spec.alt ?? spec.label;
    if (name !== undefined) out['semantic'] = { ...(current['semantic'] as Rec), label: name };
    const style = styled(spec.style, spec.tone);
    if (style) out['style'] = merge(current['style'] as Tree | undefined, style as Tree);
    if (spec.pin) {
      const at = (current['transform'] as typeof NO_BOX | undefined) ?? NO_BOX;
      out['placement'] = 'pinned';
      out['transform'] = { x: spec.pin.x, y: spec.pin.y, w: spec.pin.w ?? at.w, h: spec.pin.h ?? at.h };
    }
    return out;
  }

  private update(op: Extract<ResolvedOp, { op: 'update' }>): void {
    const current = this.rec(op.target);
    if (current) this.put({ ...current, ...this.changes(current, op.set) });
  }

  /** The ids below `id` (children, recursively). */
  private below(id: string): string[] {
    const kids = [...this.work.values()].filter((r) => r['parentId'] === id).map((r) => r['id'] as string);
    return kids.flatMap((k) => [k, ...this.below(k)]);
  }

  /** The connectors with an end on any of `ids`, and their bindings. */
  private attached(ids: ReadonlySet<string>): string[] {
    const bound = [...this.work.values()].filter((r) => r['type'] === 'binding' && ids.has(r['elementId'] as string));
    const connectors = new Set(bound.map((b) => b['connectorId'] as string));
    const bindings = [...this.work.values()].filter((r) => r['type'] === 'binding' && connectors.has(r['connectorId'] as string));
    return [...connectors, ...bindings.map((b) => b['id'] as string)];
  }

  private remove(op: Extract<ResolvedOp, { op: 'remove' }>): void {
    const id = this.idOf(op.target);
    const current = this.work.get(id);
    if (!current) return;
    if (current['kind'] === 'connector') {
      this.disconnectId(id);
      return;
    }
    const doomed = [id, ...this.below(id)];
    const gone = new Set([...doomed, ...this.attached(new Set(doomed))]);
    for (const x of gone) this.drop(x);
    const screenId = current['screenId'] as string | undefined;
    if (screenId) this.ask(screenId, current['parentId'] as string | undefined);
  }

  private disconnectId(id: string): void {
    for (const r of [...this.work.values()]) if (r['type'] === 'binding' && r['connectorId'] === id) this.drop(r['id'] as string);
    this.drop(id);
  }

  private disconnect(op: Extract<ResolvedOp, { op: 'disconnect' }>): void {
    this.disconnectId(this.idOf(op.target));
  }

  /** The id of the next unused connector for the same ends. */
  private edgeKey(screen: string, from: string, arrow: string, to: string): string {
    for (let n = 1; ; n += 1) {
      const key = idKeys.edge({ screen, from, op: arrow, to, n });
      if (!this.work.has(this.id(key))) return key;
    }
  }

  private connect(op: Extract<ResolvedOp, { op: 'connect' }>): void {
    const [screenId, source, target] = [this.idOf(op.screen), this.idOf(op.from), this.idOf(op.to)];
    const screenSlug = ((this.work.get(screenId)?.['meta'] as { slug?: string } | undefined)?.slug ?? screenId) as string;
    const key = this.edgeKey(screenSlug, this.slugOf(source), op.arrow, this.slugOf(target));
    const id = this.id(key);
    this.#edges.set(`new:edge:${op.index}`, id);
    const { markers, dashed } = opStyle(op.arrow as Parameters<typeof opStyle>[0]);
    const style = styleOf({ ...(op.spec.style ? { style: { value: op.spec.style } as unknown as LocatedStyle } : {}), dashed });
    this.put({
      id,
      type: 'element',
      screenId,
      kind: 'connector',
      index: this.indexAfterLast(screenId, undefined),
      route: { type: op.spec.route ?? 'straight' },
      markers,
      ...(op.spec.label ? { labels: [{ text: richText(op.spec.label), position: 0.5 }] } : {}),
      ...(style ? { style } : {}),
    });
    const ends = [
      ['source', source, op.anchors.from],
      ['target', target, op.anchors.to],
    ] as const;
    for (const [end, elementId, anchor] of ends)
      this.put({ id: this.id(`${key}:${end}`), type: 'binding', connectorId: id, end, elementId, anchor: anchorOf(anchor) });
    this.ask(screenId);
  }

  private setLayout(op: Extract<ResolvedOp, { op: 'setLayout' }>): void {
    const id = this.idOf(op.scope);
    const current = this.work.get(id);
    if (!current) return;
    const { type, ...options } = op.layout as LayoutIntent & { [key: string]: unknown };
    this.put({ ...current, layout: { type, ...(Object.keys(options).length > 0 ? { options } : {}) } });
    if (!op.relayout) return;
    const isScreen = current['type'] === 'screen';
    this.ask(isScreen ? id : (current['screenId'] as string), isScreen ? undefined : id);
  }

  private restyle(op: Extract<ResolvedOp, { op: 'restyle' }>): void {
    const style = styled(op.style);
    if (!style) return;
    for (const target of op.targets) {
      const current = this.rec(target);
      if (current) this.put({ ...current, style: merge(current['style'] as Tree | undefined, style as Tree) });
    }
  }
}

/**
 * Lower a resolved patch to the records it puts and deletes, and the containers it wants laid out again (ADR-0035). Ops run in order over
 * a working copy; removing an element also removes what hangs off it (its children, the connectors that end on it, their bindings).
 *
 * @public
 */
export function lowerPatch(patch: ResolvedPatch, ctx: LowerContext): Lowered {
  return new Lowering(ctx, patch).run();
}
