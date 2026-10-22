// The patch resolver and validator (ADR-0035, FR-AI-003): every ref of every op is resolved against a working copy of the document's index,
// in order (an `add` is visible to the ops after it), and nothing is written. Any problem rejects the whole patch with pointer diagnostics
// (`/ops/3/target`); `ai.applyPatch` (M14.10) lowers the resolved ops to commands inside one transaction.
import type { CoreRegistries } from '@fluxion/core';
import { buildTemplate } from '@fluxion/layout';
import { type AnyRecord, DEFAULT_SCREEN_SIZE, type Diagnostic, type DiagnosticCode } from '@fluxion/schema';
import { parseEdge } from '../parse/edge.js';
import { nearest } from '../resolve/suggest.js';
import { ESTIMATE, isTemplate, itemsOfSpec } from '../template/lower.js';
import type { PatchContext, PatchResolution, ResolvedOp, ResolvedPatch, ResolvedRef } from './resolve-types.js';
import {
  type AiPatch,
  aiPatchSchema,
  EDGE_SET_KEYS,
  type EdgeSpec,
  type LayoutIntent,
  MAX_PATCH_OPS,
  NODE_SPEC_KEYS,
  type NodeSpec,
  type PatchOp,
  type Selector,
  type StyleSpec,
} from './schema.js';
import { asRec, diagnostic, type Entry, indexOf, normalizeStrictPatch, type RefKind } from './working-index.js';

export type { PatchContext, PatchResolution, ResolvedOp, ResolvedPatch, ResolvedRef } from './resolve-types.js';

/** An edge key: `a->b` or `a~>b`. */
const EDGE_KEY = /^[^\s.<>~-][^\s<>~]*?(->|~>)\S+$/;

/** Whether an entry has the shape and the kind a selector names (a short shape name matches in any pack). */
const matches = (e: Entry, { shape, kind }: Selector): boolean =>
  (shape === undefined || e.shape === shape || e.shape?.endsWith(`:${shape}`) === true) && (kind === undefined || e.kind === kind);

/** The edge shorthand `a.e -> b: label` as its key text and its label (empty when there is none). */
function splitEdge(text: string): readonly [string, string] {
  const colon = text.indexOf(':');
  return colon < 0 ? [text.trim(), ''] : [text.slice(0, colon).trim(), text.slice(colon + 1).trim()];
}

const ref = (e: Entry): ResolvedRef => ({ id: e.id, kind: e.kind });

class Resolver {
  readonly out: Diagnostic[] = [];
  readonly index: Map<string, Entry>;
  private readonly ctx: PatchContext;
  constructor(ctx: PatchContext) {
    this.ctx = ctx;
    this.index = indexOf(ctx.records);
  }

  fail(code: DiagnosticCode, path: readonly (string | number)[], message: string, hint?: string): undefined {
    this.out.push(diagnostic(code, path, message, hint));
    return undefined;
  }

  /** A slug or edge-less reference to an entry of the working copy; `screen` limits slugs to one screen. */
  lookup(text: string, path: readonly (string | number)[], want: readonly RefKind[], screen?: string): Entry | undefined {
    if (text.startsWith('#')) {
      const e = this.index.get(text.slice(1));
      if (e && want.includes(e.kind)) return e;
      return this.fail('FLX_PATCH_REF_UNKNOWN', path, `no ${want.join(' or ')} has the id "${text}"`, 'ids are written #<RecordId>');
    }
    const found = [...this.index.values()].filter(
      (e) => e.slug === text && want.includes(e.kind) && (screen === undefined || e.kind === 'screen' || e.screen === screen),
    );
    if (found.length === 1) return found[0];
    const names = [...this.index.values()].filter((e) => e.slug !== undefined && want.includes(e.kind)).map((e) => e.slug as string);
    if (found.length === 0) {
      const near = nearest(text, names);
      return this.fail(
        'FLX_PATCH_REF_UNKNOWN',
        path,
        `"${text}" matches no ${want.join(' or ')}`,
        near ? `did you mean "${near}"?` : 'use a slug the document has, or one an earlier op adds',
      );
    }
    return this.fail('FLX_PATCH_REF_AMBIGUOUS', path, `"${text}" matches ${found.length} elements`, 'give the op a screen, or write #<RecordId>');
  }

  /** An edge key `a->b` / `a~>b` (screen-scoped when given), or a connector id. */
  connector(text: string, path: readonly (string | number)[], screen?: string): Entry | undefined {
    if (text.startsWith('#')) return this.lookup(text, path, ['connector']);
    const m = /^([^\s.<>~-][^\s<>~]*?)(->|~>)(\S+)$/.exec(text);
    if (!m) return this.fail('FLX_PATCH_REF_UNKNOWN', path, `"${text}" is not an edge key`, 'write a->b, a~>b or #<RecordId>');
    const [from, to] = [this.lookup(m[1] as string, path, ['element', 'group'], screen), this.lookup(m[3] as string, path, ['element', 'group'], screen)];
    if (!from || !to) return undefined;
    const found = [...this.index.values()].filter((e) => e.kind === 'connector' && e.ends?.[0] === from.id && e.ends[1] === to.id);
    if (found.length === 1) return found[0];
    if (found.length === 0) return this.fail('FLX_PATCH_REF_UNKNOWN', path, `no connector runs from "${m[1]}" to "${m[3]}"`);
    return this.fail('FLX_PATCH_REF_AMBIGUOUS', path, `${found.length} connectors run from "${m[1]}" to "${m[3]}"`, 'write the one you mean as #<RecordId>');
  }

  /** A node payload: the shape must exist (short names through every pack) when registries are known. */
  node(spec: NodeSpec, path: readonly (string | number)[]): void {
    const shape = spec.shape;
    const reg = this.ctx.registries;
    if (shape === undefined || reg === undefined) return;
    const all = reg.shapeDefs.list().map(([key]) => key);
    if (all.includes(shape)) return;
    const matches = all.filter((id) => id.endsWith(`:${shape}`));
    if (matches.length === 1) return;
    if (matches.length > 1)
      void this.fail('FLX_PATCH_OP_INVALID', [...path, 'shape'], `"${shape}" is a shape of ${matches.length} packs`, `write ${matches.join(' or ')}`);
    else {
      const near = nearest(shape, all.concat(all.map((id) => id.split(':')[1] ?? id)));
      void this.fail(
        'FLX_PATCH_OP_INVALID',
        [...path, 'shape'],
        `no shape "${shape}" is registered`,
        near ? `did you mean "${near}"?` : 'see the catalog for shape ids',
      );
    }
  }

  op(op: PatchOp, i: number): ResolvedOp | undefined {
    switch (op.op) {
      case 'add':
        return this.add(op, i);
      case 'update':
        return this.update(op, i);
      case 'remove':
        return this.remove(op, i);
      case 'connect':
        return this.connect(op, i);
      case 'disconnect':
        return this.disconnect(op, i);
      case 'setLayout':
        return this.setLayout(op, i);
      case 'restyle':
        return this.restyle(op, i);
      case 'addStep':
      case 'addInteraction':
        return this.fail(
          'FLX_PATCH_OP_INVALID',
          ['ops', i],
          `${op.op} is not applied yet`,
          'steps and interactions compile from M18; use add/connect/update for now',
        );
    }
  }

  /** The group an `add` puts the node in: in the op's screen, else a conflict. */
  private parentOf(op: Extract<PatchOp, { op: 'add' }>, i: number, screen: Entry | undefined): Entry | undefined {
    if (op.parent === undefined) return undefined;
    const parent = this.lookup(op.parent, ['ops', i, 'parent'], ['group'], screen?.id);
    if (!parent || !screen || parent.screen === screen.id) return parent;
    return this.fail('FLX_PATCH_CONFLICT', ['ops', i, 'parent'], `"${op.parent}" is in another screen`, 'a parent is a group of the same screen');
  }

  private add(op: Extract<PatchOp, { op: 'add' }>, i: number): ResolvedOp | undefined {
    const screen = this.lookup(op.screen, ['ops', i, 'screen'], ['screen']);
    const dup = [...this.index.values()].some((e) => e.slug === op.slug && e.kind !== 'screen');
    if (dup)
      this.fail('FLX_PATCH_CONFLICT', ['ops', i, 'slug'], `the slug "${op.slug}" is already used`, 'choose a new slug; slugs are unique in the document');
    this.node(op.node, ['ops', i, 'node']);
    const parent = this.parentOf(op, i, screen);
    if (!screen || dup || (op.parent !== undefined && !parent)) return undefined;
    const entry: Entry = { id: `new:${op.slug}`, kind: 'element', slug: op.slug, screen: screen.id, ...(parent ? { parent: parent.id } : {}) };
    if (op.node.shape) entry.shape = op.node.shape;
    this.index.set(entry.id, entry);
    return { op: 'add', index: i, screen: ref(screen), slug: op.slug, ...(parent ? { parent: ref(parent) } : {}), node: op.node };
  }

  private update(op: Extract<PatchOp, { op: 'update' }>, i: number): ResolvedOp | undefined {
    const at = ['ops', i, 'target'];
    // an edge key or a connector's id names an edge; anything else a node
    const target = EDGE_KEY.test(op.target) ? this.connector(op.target, at) : this.lookup(op.target, at, ['element', 'group', 'connector']);
    // an edge key is checked as an edge's keys even when it names no connector (its own error says so)
    const edge = EDGE_KEY.test(op.target) || target?.kind === 'connector';
    const wrong = Object.keys(op.set).filter((k) => !(edge ? EDGE_SET_KEYS : NODE_SPEC_KEYS).includes(k));
    for (const k of wrong)
      void this.fail(
        'FLX_PATCH_OP_INVALID',
        ['ops', i, 'set', k],
        `"${k}" is not a key of ${edge ? 'an edge' : 'a node'}`,
        edge ? `an edge takes ${EDGE_SET_KEYS.join(', ')}` : `a node takes ${NODE_SPEC_KEYS.join(', ')}`,
      );
    if (!edge) this.node(op.set as NodeSpec, ['ops', i, 'set']);
    return target && wrong.length === 0 ? { op: 'update', index: i, target: ref(target), set: op.set, ...(edge ? { edge } : {}) } : undefined;
  }

  /** The ids of everything inside the group `id`, at any depth. */
  private below(id: string): string[] {
    const kids = [...this.index.values()].filter((e) => e.parent === id).map((e) => e.id);
    return kids.flatMap((k) => [k, ...this.below(k)]);
  }

  private remove(op: Extract<PatchOp, { op: 'remove' }>, i: number): ResolvedOp | undefined {
    const target = this.lookup(op.target, ['ops', i, 'target'], ['element', 'group', 'connector']);
    if (!target) return undefined;
    const doomed = new Set([target.id, ...this.below(target.id)]);
    const attached = [...this.index.values()]
      .filter((e) => e.kind === 'connector' && (doomed.has(e.ends?.[0] ?? '') || doomed.has(e.ends?.[1] ?? '')))
      .map((e) => e.id);
    if (attached.length > 0 && op.cascade !== true)
      return this.fail(
        'FLX_PATCH_CONFLICT',
        ['ops', i, 'target'],
        `"${op.target}" still has ${attached.length} connector(s)`,
        'set cascade: true, or disconnect them first',
      );
    for (const x of doomed) this.index.delete(x);
    for (const c of attached) this.index.delete(c);
    return { op: 'remove', index: i, target: ref(target), connectors: attached };
  }

  private connect(op: Extract<PatchOp, { op: 'connect' }>, i: number): ResolvedOp | undefined {
    const path = ['ops', i, 'edge'];
    const [key, label] = splitEdge(op.edge);
    const parsed = parseEdge(key);
    if (!parsed.ok) return this.fail('FLX_PATCH_OP_INVALID', path, `"${op.edge}" is not an edge`, 'write a -> b, a -> b: label');
    const { from, op: arrow, to } = parsed.edge;
    const [a, b] = [this.lookup(from.slug, path, ['element', 'group']), this.lookup(to.slug, path, ['element', 'group'])];
    if (!a || !b) return undefined;
    const screen = a.screen === b.screen && a.screen ? this.index.get(a.screen) : undefined;
    if (!screen)
      return this.fail('FLX_PATCH_CONFLICT', path, `"${from.slug}" and "${to.slug}" are in different screens`, 'an edge joins two elements of one screen');
    const spec = label === '' || op.spec?.label !== undefined ? (op.spec ?? {}) : { ...op.spec, label };
    const anchors = { ...(from.anchor ? { from: from.anchor } : {}), ...(to.anchor ? { to: to.anchor } : {}) };
    // later ops see the connector: it can be removed or disconnected, and a remove of its end finds it attached
    const added: Entry = { id: `new:edge:${i}`, kind: 'connector', screen: screen.id, ends: [a.id, b.id] };
    this.index.set(added.id, added);
    return { op: 'connect', index: i, screen: ref(screen), from: ref(a), to: ref(b), arrow, anchors, spec };
  }

  private disconnect(op: Extract<PatchOp, { op: 'disconnect' }>, i: number): ResolvedOp | undefined {
    const target = this.connector(op.target, ['ops', i, 'target']);
    if (target) this.index.delete(target.id);
    return target ? { op: 'disconnect', index: i, target: ref(target) } : undefined;
  }

  private setLayout(op: Extract<PatchOp, { op: 'setLayout' }>, i: number): ResolvedOp | undefined {
    const scope = this.lookup(op.scope, ['ops', i, 'scope'], ['screen', 'group']);
    const reg = this.ctx.registries;
    if (op.layout.type === 'template') return this.template(op, i, scope);
    if (reg && !reg.layouts.get(op.layout.type)) {
      const near = nearest(
        op.layout.type,
        reg.layouts.list().map(([key]) => key),
      );
      return this.fail(
        'FLX_PATCH_OP_INVALID',
        ['ops', i, 'layout', 'type'],
        `no layout "${op.layout.type}" is registered`,
        near ? `did you mean "${near}"?` : 'see the catalog for layout names',
      );
    }
    return scope ? { op: 'setLayout', index: i, scope: ref(scope), layout: op.layout, relayout: op.relayout !== false } : undefined;
  }

  /** A `setLayout` of a template: a screen, a template the registry has, items and options it accepts. */
  private template(op: Extract<PatchOp, { op: 'setLayout' }>, i: number, scope: Entry | undefined): ResolvedOp | undefined {
    const at = ['ops', i, 'layout'];
    const bad = (path: string, message: string, hint?: string) => this.fail('FLX_PATCH_OP_INVALID', [...at, path], message, hint);
    if (scope && scope.kind !== 'screen') return bad('type', 'a template is built into a screen, not a group', 'name the screen as the scope');
    const { id, items, options } = op.layout;
    if (id === undefined || items === undefined)
      return bad('id', 'a template layout needs an id and items', '{ type: "template", id: "process.basic", items: ["Plan", "Build"] }');
    const reg = this.ctx.registries;
    if (!reg) return scope ? { op: 'setLayout', index: i, scope: ref(scope), layout: op.layout, relayout: false } : undefined;
    const def = reg.templates.get(id);
    if (!isTemplate(def)) {
      const near = nearest(
        id,
        reg.templates.list().map(([key]) => key),
      );
      return bad('id', `no template "${id}" is registered`, near ? `did you mean "${near}"?` : 'see the catalog for template ids');
    }
    const built = buildTemplate(def, itemsOfSpec(items), options, { frame: { x: 0, y: 0, ...DEFAULT_SCREEN_SIZE }, measure: ESTIMATE });
    if (!built.ok) return bad('items', built.message);
    return scope ? { op: 'setLayout', index: i, scope: ref(scope), layout: op.layout, relayout: false } : undefined;
  }

  /** The elements a selector picks, in the working copy. */
  private select(select: Selector, i: number): readonly Entry[] | undefined {
    const path = ['ops', i, 'targets', 'select'];
    const screen = select.screen === undefined ? undefined : this.lookup(select.screen, [...path, 'screen'], ['screen']);
    if (select.screen !== undefined && !screen) return undefined;
    const hits = [...this.index.values()].filter((e) => e.kind !== 'screen' && (screen === undefined || e.screen === screen.id) && matches(e, select));
    if (hits.length > 0) return hits;
    return this.fail('FLX_PATCH_REF_UNKNOWN', path, 'the selector matches no element', 'loosen the selector, or name the elements');
  }

  private restyle(op: Extract<PatchOp, { op: 'restyle' }>, i: number): ResolvedOp | undefined {
    const found =
      'select' in op.targets
        ? this.select(op.targets.select, i)
        : op.targets.map((t, k) => this.lookup(t, ['ops', i, 'targets', k], ['element', 'group', 'connector']));
    if (found === undefined || found.some((t) => t === undefined)) return undefined;
    return { op: 'restyle', index: i, targets: (found as readonly Entry[]).map(ref), style: op.style };
  }
}

/**
 * Resolve and validate an AI patch (ADR-0035) against a document, writing nothing. `input` is the plain or the strict form of the patch.
 * Every op is checked in order against a working copy, so an op sees the slugs earlier ops add; if any op is invalid, the diagnostics
 * of all of them come back (each with a pointer into the patch) and no op is returned.
 *
 * @public
 */
export function resolvePatch(input: unknown, context: PatchContext): PatchResolution {
  const raw = asRec(input);
  if (Array.isArray(raw?.['ops']) && raw['ops'].length > MAX_PATCH_OPS)
    return { ok: false, diagnostics: [diagnostic('FLX_PATCH_TOO_LARGE', ['ops'], `${raw['ops'].length} ops; at most ${MAX_PATCH_OPS}`, 'split the patch')] };
  const parsed = aiPatchSchema.safeParse(normalizeStrictPatch(input));
  if (!parsed.success)
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic(
          'FLX_PATCH_OP_INVALID',
          issue.path.filter((p): p is string | number => typeof p !== 'symbol'),
          issue.message,
          'see the patch schema (specs/schema/ai-patch.schema.json)',
        ),
      ),
    };
  const patch: AiPatch = parsed.data;
  if (patch.baseRevision !== undefined && context.revision !== undefined && patch.baseRevision !== context.revision)
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'FLX_PATCH_STALE',
          ['baseRevision'],
          `the patch is for ${patch.baseRevision}; the document is at ${context.revision}`,
          'read the document again and rewrite the patch against its revision',
        ),
      ],
    };
  const r = new Resolver(context);
  const ops = patch.ops.map((op, i) => r.op(op, i));
  if (r.out.length > 0 || ops.some((o) => o === undefined)) return { ok: false, diagnostics: r.out };
  return { ok: true, value: { ops: ops as ResolvedOp[] } };
}
