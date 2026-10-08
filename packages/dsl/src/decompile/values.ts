// Document values back to FluxScript values (FR-DSL-002): the inverse of the style stage (expand/style.ts) and of the rich text expand
// writes. A value the grammar cannot write so that it compiles back to itself throws `Inexpressible`; the element holding it is then kept
// out of the block (ADR-0032).
import type { AnchorRef, LayoutSpec, RichTextDoc, Style } from '@fluxion/schema';
import type { StyleAst } from '../read/ast.js';
import type { Out, OutMap } from './emit.js';

/** Thrown by a reader for a value outside the v0 subset. */
export class Inexpressible extends Error {}

/** Fail: the value is outside the v0 subset. */
export function fail(what: string): never {
  throw new Inexpressible(what);
}

const TOKEN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const REF = /^\{([^{}]+)\}$/;
const SLUG = /^[a-z][a-z0-9-]*$/;

type Obj = { readonly [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysAre = (v: Obj, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));

/** A text run with no marks: its text. */
function run(node: unknown): string {
  if (!isObj(node) || node['type'] !== 'text' || typeof node['text'] !== 'string' || !keysAre(node, ['type', 'text', 'marks'])) fail('rich text');
  if (Array.isArray(node['marks']) ? node['marks'].length > 0 : node['marks'] !== undefined) fail('marks');
  return node['text'] as string;
}

/** A paragraph of plain runs: its text. */
function line(node: unknown): string {
  if (!isObj(node) || node['type'] !== 'paragraph' || !keysAre(node, ['type', 'content'])) fail('rich text');
  const content = node['content'];
  if (content === undefined) return '';
  if (!Array.isArray(content)) fail('rich text');
  return content.map(run).join('');
}

/** Rich text of plain paragraphs as text, one line per paragraph (the inverse of expand's `richText`). */
export function plainText(doc: RichTextDoc | undefined): string | undefined {
  if (doc === undefined) return undefined;
  const content = (doc as Obj)['content'];
  if (!Array.isArray(content) || content.length === 0) fail('rich text');
  return content.map(line).join('\n');
}

/** A style value as FluxScript writes it: a token reference as its name; a string that would read as a token name cannot be written. */
function styleValue(v: unknown): string | number | boolean {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'string') return fail('style value');
  const ref = REF.exec(v)?.[1];
  if (ref !== undefined && TOKEN.test(ref)) return ref;
  if (TOKEN.test(v)) fail('style value');
  return v;
}

/** One entry of a style at dot path `path`: its leaves, pushed to `out`. */
function leaf(path: string, v: unknown, out: [string, Out][]): void {
  if (isObj(v)) {
    if (Object.keys(v).length === 0) fail('empty style');
    leaves(v, path, out);
  } else if (path === 'stroke') fail('style key');
  else out.push([path, styleValue(v)]);
}

/** The leaves of a style as dot paths (`stroke.color`), `stroke.dash` and `variant` left out. */
function leaves(style: Obj, prefix: string, out: [string, Out][]): void {
  for (const [k, v] of Object.entries(style)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (k.includes('.')) fail('style key');
    if (path !== 'stroke.dash' && path !== 'variant') leaf(path, v, out);
  }
}

const PRESETS: readonly (readonly [Exclude<StyleAst, object>, string])[] = [
  ['solid', '[]'],
  ['dashed', '[8,4]'],
  ['dotted', '[2,4]'],
];

/** The stroke preset of a dash, or undefined when there is no dash. */
function presetOf(dash: unknown): Exclude<StyleAst, object> | undefined {
  if (dash === undefined) return undefined;
  const found = PRESETS.find(([, d]) => d === JSON.stringify(dash));
  return found ? found[0] : fail('dash');
}

/** What styles an element in FluxScript: its `style:` and, for a node, its `tone:`. */
export type StyleOut = { readonly style?: Out; readonly tone?: string };

/** How a style is read back: whether its variant is a node's tone, and whether the element is dashed unless styled otherwise (`~>`). */
export type StyleMode = { readonly tone: boolean; readonly dashed: boolean };

/**
 * The FluxScript of a document style (the inverse of `styleOf`): a stroke preset alone, or a map of dot paths. A dash with other style
 * keys, or a dash no preset has, cannot be written.
 */
export function styleOut(style: Style | undefined, mode: StyleMode): StyleOut {
  const s: Obj = style ?? {};
  const variant = s['variant'];
  if (variant !== undefined && typeof variant !== 'string') fail('variant');
  const preset = presetFor(isObj(s['stroke']) ? s['stroke']['dash'] : undefined, mode.dashed);
  const map: [string, Out][] = [];
  leaves(s, '', map);
  if (variant !== undefined && !mode.tone) map.unshift(['variant', variant]);
  if (preset !== undefined && map.length > 0) fail('dash with style');
  const tone = mode.tone && variant !== undefined ? { tone: variant } : {};
  if (preset !== undefined) return { style: preset, ...tone };
  return map.length > 0 ? { style: { map, flow: true }, ...tone } : tone;
}

/** The preset a style writes for its dash: none for no dash, or for an element dashed by its op whose dash is that op's. */
function presetFor(dash: unknown, dashed: boolean): Exclude<StyleAst, object> | undefined {
  const preset = presetOf(dash);
  if (!dashed) return preset;
  if (preset === undefined) fail('dash');
  return preset === 'dashed' ? undefined : preset;
}

/** A JSON value (layout options) as written. */
export function jsonOut(v: unknown): Out {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return { seq: v.map(jsonOut), flow: true };
  if (isObj(v)) return { map: Object.entries(v).map(([k, x]) => [k, jsonOut(x)] as const), flow: true };
  return fail('layout option');
}

/** A layout spec as `{ type, ...options }`. */
export function layoutOut(l: LayoutSpec): OutMap {
  return { map: [['type', l.type], ...Object.entries(l.options ?? {}).map(([k, v]) => [k, jsonOut(v)] as const)], flow: true };
}

/** A background: a token reference as its name, a colour as written; anything else (a gradient, an image) cannot be written. */
export function paintOut(p: unknown): string {
  if (typeof p !== 'string') return fail('paint');
  return String(styleValue(p));
}

const ANCHORS: { readonly [kind: string]: (a: AnchorRef & Obj) => string } = {
  auto: (a) => (keysAre(a, ['kind']) ? '' : fail('anchor')),
  side: (a) => (keysAre(a, ['kind', 'side']) ? `.${String(a['side'])}` : fail('anchor')),
  named: (a) => (keysAre(a, ['kind', 'name']) && SLUG.test(String(a['name'])) ? `.${String(a['name'])}` : fail('anchor')),
};

/** An edge end's anchor suffix (`.e`, `.out-1`, or nothing for auto); a point or floating anchor cannot be written. */
export function anchorSuffix(a: AnchorRef | undefined): string {
  const read = a ? ANCHORS[(a as Obj)['kind'] as string] : undefined;
  return read ? read(a as AnchorRef & Obj) : fail('anchor');
}
