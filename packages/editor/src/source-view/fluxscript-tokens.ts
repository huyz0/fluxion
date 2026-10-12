// The FluxScript layer over the Lezer YAML tree (FR-DSL-009, ADR-0032): which ranges of a document are edge ops, slugs, anchors, keys, shape
// ids and pack names. Pure: text in, ranges out, no DOM. The edge ends come from `@fluxion/dsl`'s own tokenizer (`parseEdge`) and the key
// names from its key table (`fluxScriptKeys`), so the highlighting cannot drift from the compiler. Part of the lazy source-view chunk.
import { yamlLanguage } from '@codemirror/lang-yaml';
import { type EdgeEnd, type FluxScriptKeyTable, fluxScriptKeys, parseEdge, parseEdgeObject } from '@fluxion/dsl';

/** The class of a FluxScript token (the CSS class a decoration carries). */
export type FluxScriptTokenClass = 'fx-key' | 'fx-key-deferred' | 'fx-op' | 'fx-slug' | 'fx-anchor' | 'fx-pack' | 'fx-shape';

/** A range of the document with the FluxScript class it is marked with. */
export type FluxScriptToken = { readonly from: number; readonly to: number; readonly class: FluxScriptTokenClass };

type Level = keyof FluxScriptKeyTable;
/** What a value holds, by the key above it: a mapping of a level, a sequence of mappings of a level, or a mapping of slugs to mappings. */
type Shape = { readonly of: 'map'; readonly level: Level } | { readonly of: 'items'; readonly level: Level } | { readonly of: 'slugs'; readonly level: Level };

/** The shape of the value under `key` at `level` (ADR-0030's document layout), if the compiler reads one. */
const CHILD: { readonly [L in Level]?: { readonly [key: string]: Shape } } = {
  top: { theme: { of: 'map', level: 'theme' }, screens: { of: 'items', level: 'screen' } },
  screen: { nodes: { of: 'slugs', level: 'node' }, groups: { of: 'slugs', level: 'group' }, edges: { of: 'items', level: 'edge' } },
  node: { pin: { of: 'map', level: 'pin' } },
};

type Tree = ReturnType<typeof yamlLanguage.parser.parse>;
type Node = Tree['topNode'];
/** A scalar's characters (quotes left out) and where they start. */
type Scalar = { readonly value: string; readonly from: number };

const children = (n: Node, name?: string): Node[] => {
  const out: Node[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (name === undefined || c.name === name) out.push(c);
  return out;
};
const isMapping = (n: Node) => n.name === 'BlockMapping' || n.name === 'FlowMapping';
const isSequence = (n: Node) => n.name === 'BlockSequence' || n.name === 'FlowSequence';
/** The value node of a pair: its last child, unless that is the key or the colon (`a:` with nothing after it). */
const pairValue = (pair: Node): Node | undefined => {
  const last = pair.lastChild;
  return last && last.name !== 'Key' && last.name !== ':' ? last : undefined;
};

class Collector {
  readonly tokens: FluxScriptToken[] = [];
  readonly src: string;
  readonly keys: FluxScriptKeyTable;
  constructor(src: string, keys: FluxScriptKeyTable) {
    this.src = src;
    this.keys = keys;
  }

  /** The scalar inside a key or a value (a `Literal` or a `QuotedLiteral`). */
  scalar(n: Node | null | undefined): Scalar | undefined {
    if (!n) return undefined;
    if (n.name === 'Key') return this.scalar(n.firstChild);
    if (n.name === 'Literal') return { value: this.src.slice(n.from, n.to), from: n.from };
    if (n.name === 'QuotedLiteral') return { value: this.src.slice(n.from + 1, n.to - 1), from: n.from + 1 };
    return undefined;
  }

  add(from: number, to: number, cls: FluxScriptTokenClass): void {
    if (to > from) this.tokens.push({ from, to, class: cls });
  }

  /** An end of an edge, `slug` or `slug.anchor`, whose first character is at `at`. */
  end(e: EdgeEnd, at: number): void {
    this.add(at, at + e.slug.length, 'fx-slug');
    if (e.anchor !== undefined) this.add(at + e.slug.length + 1, at + e.slug.length + 1 + e.anchor.length, 'fx-anchor');
  }

  /** The shorthand key `a.e -> b`: the compiler's tokenizer decides what is an end and what is the op; a text it refuses is left unmarked. */
  shorthand(key: Scalar): void {
    const r = parseEdge(key.value);
    if (!r.ok) return;
    const { from, op, to } = r.edge;
    this.end(from, key.from + from.col - 1);
    this.end(to, key.from + to.col - 1);
    const afterFrom = from.col - 1 + from.slug.length + (from.anchor === undefined ? 0 : from.anchor.length + 1);
    const opAt = key.from + key.value.indexOf(op, afterFrom);
    this.add(opAt, opAt + op.length, 'fx-op');
  }

  /** An edge entry with no label: the entry is a scalar. */
  bareEdge(node: Node): void {
    const s = this.scalar(node);
    if (s) this.shorthand(s);
  }

  /** The object form `{ from, to, op }`, read through `parseEdgeObject` so a malformed edge marks nothing. */
  object(pairs: ReadonlyMap<string, Scalar>): void {
    const f = pairs.get('from');
    const t = pairs.get('to');
    const o = pairs.get('op');
    if (!f || !t) return;
    const r = parseEdgeObject({ from: f.value, to: t.value, ...(o ? { op: o.value } : {}) });
    if (!r.ok) return;
    this.end(r.edge.from, f.from + r.edge.from.col - 1);
    this.end(r.edge.to, t.from + r.edge.to.col - 1);
    if (o) this.add(o.from, o.from + o.value.length, 'fx-op');
  }

  /** `shape: basic:rect`, `component: basic:stat`: the pack (when qualified) and the shape. */
  shapeId(v: Scalar): void {
    const colon = v.value.indexOf(':');
    if (colon > 0) this.add(v.from, v.from + colon, 'fx-pack');
    this.add(v.from + (colon > 0 ? colon + 1 : 0), v.from + v.value.length, 'fx-shape');
  }

  /** A key, marked when its level's table lists it. */
  markKey(key: Scalar, level: Level | undefined): void {
    const table = level === undefined ? undefined : this.keys[level];
    if (table?.compiled.includes(key.value)) this.add(key.from, key.from + key.value.length, 'fx-key');
    else if (table?.deferred.includes(key.value)) this.add(key.from, key.from + key.value.length, 'fx-key-deferred');
  }

  /** The pairs of a mapping at `level`; in a sequence of edges (`edgeEntry`) a key with a space is the shorthand. */
  mapping(node: Node, level: Level | undefined, edgeEntry: boolean): void {
    const scalars = new Map<string, Scalar>();
    for (const pair of children(node, 'Pair')) {
      const key = this.scalar(pair.getChild('Key'));
      if (!key) continue;
      const v = this.pair(pair, key, level, edgeEntry);
      if (v) scalars.set(key.value, v);
    }
    if (edgeEntry) this.object(scalars);
  }

  /** One pair: its key (or the shorthand it is), a shape id value, and the value's descendants. Gives the value when it is a scalar. */
  pair(pair: Node, key: Scalar, level: Level | undefined, edgeEntry: boolean): Scalar | undefined {
    const shorthand = edgeEntry && /\s/.test(key.value);
    if (shorthand) this.shorthand(key);
    else this.markKey(key, level);
    const value = pairValue(pair);
    const v = this.scalar(value);
    if (v && (key.value === 'shape' || key.value === 'component')) this.shapeId(v);
    if (value) this.value(key.value, value, level, shorthand);
    return v;
  }

  /** The value under `key`: descend by the document layout, and mark `uses` packs wherever they stand. */
  value(key: string, value: Node, level: Level | undefined, shorthand: boolean): void {
    if (key === 'uses' && isSequence(value)) {
      for (const item of children(value, 'Item')) {
        const s = this.scalar(item.firstChild);
        if (s) this.add(s.from, s.from + s.value.length, 'fx-pack');
      }
      return;
    }
    this.descend(value, shorthand ? { of: 'map', level: 'edge' } : level ? CHILD[level]?.[key] : undefined);
  }

  descend(node: Node, shape: Shape | undefined): void {
    if (isMapping(node)) this.descendMapping(node, shape);
    else if (isSequence(node)) this.descendSequence(node, shape);
  }

  /** A mapping of slugs to mappings (`nodes`, `groups`) descends into each value; any other mapping is read as a level. */
  descendMapping(node: Node, shape: Shape | undefined): void {
    if (shape?.of !== 'slugs') {
      this.mapping(node, shape?.of === 'map' ? shape.level : undefined, false);
      return;
    }
    for (const pair of children(node, 'Pair')) {
      const v = pairValue(pair);
      if (v) this.descend(v, { of: 'map', level: shape.level });
    }
  }

  /** The mappings of a sequence, read as the level its key gives (an `edges` item may also be a bare scalar: `- api -> db`). */
  descendSequence(node: Node, shape: Shape | undefined): void {
    const level = shape?.of === 'items' ? shape.level : undefined;
    for (const item of children(node, 'Item')) {
      const inner = item.firstChild;
      if (inner && isMapping(inner)) this.mapping(inner, level, level === 'edge');
      // `- api -> db` with no label has no colon, so YAML reads the whole entry as one scalar
      else if (inner && level === 'edge') this.bareEdge(inner);
    }
  }
}

/**
 * The FluxScript tokens of a document: edge ops, slugs and anchors of the edges (shorthand and object form), keys of the key table
 * (compiled and deferred), shape ids with their packs, and the packs `uses` names. Ranges are sorted by position and never overlap.
 *
 * @param src - the FluxScript text
 * @returns the ranges, each with its class
 */
export function fluxScriptTokens(src: string): readonly FluxScriptToken[] {
  const tree = yamlLanguage.parser.parse(src);
  const c = new Collector(src, fluxScriptKeys());
  const doc = tree.topNode.getChild('Document');
  const root = doc?.firstChild;
  if (root && isMapping(root)) c.mapping(root, 'top', false);
  return [...c.tokens].sort((a, b) => a.from - b.from);
}
