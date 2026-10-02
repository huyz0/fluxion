// Document builders for tests, fixtures and examples (testing.md §3: fixtures are built, never
// hand-copied JSON). Deterministic: IDs come from a seeded Random, indices are appended per
// sibling group, so the same calls give the same document.
import { type DocumentFile, SCHEMA_VERSION } from '../document-file.js';
import { type IndexKey, keyBetween } from '../fractional-index.js';
import { createId, type Random, type RecordId, seededRandom } from '../ids.js';
import type { AnchorRef, BindingRecord } from '../records/binding.js';
import type { ConnectorElement, Route, ShapeElement, TextElement } from '../records/element.js';
import type { Point } from '../records/element-base.js';
import type { ScreenRecord } from '../records/screen.js';
import type { RichTextDoc } from '../rich-text.js';
import type { Style, Transform } from '../style.js';

/**
 * Options of a shape or text built by {@link DocumentBuilder}.
 *
 * @public
 */
export type RectOptions = {
  /** Left edge (default 0). */
  readonly x?: number;
  /** Top edge (default 0). */
  readonly y?: number;
  /** Width (default 160). */
  readonly w?: number;
  /** Height (default 80). */
  readonly h?: number;
  /** Rotation in degrees. */
  readonly rot?: number;
  /** Shape definition (default `basic:rect`). */
  readonly defId?: `${string}:${string}`;
  /** Text inside, as a plain string. */
  readonly label?: string;
  /** Document-unique slug. */
  readonly slug?: string;
  /** Style. */
  readonly style?: Style;
  /** Containing group or frame. */
  readonly parentId?: RecordId;
};

/**
 * Options of a connector built by {@link DocumentBuilder.connect}.
 *
 * @public
 */
export type ConnectOptions = {
  /** Routing style (default `straight`). */
  readonly route?: Route['type'];
  /** Source anchor (default `floating`). */
  readonly sourceAnchor?: AnchorRef;
  /** Target anchor (default `floating`). */
  readonly targetAnchor?: AnchorRef;
  /** Arrow at the target end (default true). */
  readonly arrow?: boolean;
};

/**
 * What a test screen may be given.
 *
 * @public
 */
export type ScreenOptions = {
  /** Its name. */
  readonly name?: string;
  /** A fixed screen's size. */
  readonly size?: { readonly w: number; readonly h: number };
  /** `infinite` needs a `viewport`. */
  readonly kind?: 'fixed' | 'infinite';
  /** An infinite screen's viewport. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/**
 * Builds one document; every method returns the id of what it added.
 *
 * @public
 */
export type DocumentBuilder = {
  /** Add a screen (appended after the existing ones). */
  screen(options?: ScreenOptions): RecordId;
  /** Add a shape to a screen. */
  rect(screenId: RecordId, options?: RectOptions): RecordId;
  /** Add a text element to a screen. */
  text(screenId: RecordId, text: string, options?: RectOptions): RecordId;
  /** Connect two elements (bound ends) or an element and a free point. */
  connect(from: RecordId | Point, to: RecordId | Point, options?: ConnectOptions): RecordId;
  /** The document built so far. */
  build(): DocumentFile;
};

/**
 * A rich-text document of one paragraph holding `text`.
 *
 * @public
 */
export function plainText(text: string): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }] };
}

type Rec = DocumentFile['records'][string];
type Placed = Pick<ShapeElement, 'id' | 'type' | 'screenId' | 'index'> & { readonly parentId?: RecordId };

const box = (o: RectOptions): Transform => ({ x: o.x ?? 0, y: o.y ?? 0, w: o.w ?? 160, h: o.h ?? 80, ...(o.rot === undefined ? {} : { rot: o.rot }) });
const extras = (o: RectOptions): { readonly semantic?: { readonly slug: string }; readonly style?: Style } => ({
  ...(o.slug === undefined ? {} : { semantic: { slug: o.slug } }),
  ...(o.style === undefined ? {} : { style: o.style }),
});

class Builder implements DocumentBuilder {
  readonly #random: Random;
  readonly #records: { [id: string]: Rec } = {};
  readonly #last = new Map<string, IndexKey>();

  constructor(seed: number, title: string | undefined) {
    this.#random = seededRandom(seed);
    this.#add({ id: this.#id(), type: 'document', ...(title === undefined ? {} : { title }) });
  }

  #id(): RecordId {
    return createId(this.#random);
  }

  #add<R extends Rec>(record: R): RecordId {
    this.#records[record.id] = record;
    return record.id;
  }

  /** The next index of a sibling group (appending never fails, ADR-0012). */
  #index(group: string): IndexKey {
    const key = keyBetween(this.#last.get(group) ?? null, null);
    const value = key.ok ? key.value : ('a0' as IndexKey);
    this.#last.set(group, value);
    return value;
  }

  #placed(screenId: RecordId, parentId: RecordId | undefined): Placed {
    const index = this.#index(`${screenId}/${parentId ?? ''}`);
    return { id: this.#id(), type: 'element', screenId, index, ...(parentId === undefined ? {} : { parentId }) };
  }

  /** The screen of an element id, or of the first screen for two free points. */
  #screenOf(from: RecordId | Point, to: RecordId | Point): RecordId {
    const id = typeof from === 'string' ? from : typeof to === 'string' ? to : undefined;
    const r = id === undefined ? undefined : this.#records[id];
    if (r !== undefined && typeof r['screenId'] === 'string') return r['screenId'] as RecordId;
    return (Object.values(this.#records).find((x) => x.type === 'screen')?.id ?? '') as RecordId;
  }

  /** Bind one connector end to an element (returns nothing) or return the free point. */
  #end(connectorId: RecordId, end: 'source' | 'target', at: RecordId | Point, anchor: AnchorRef | undefined): Point | undefined {
    if (typeof at !== 'string') return at;
    const binding: BindingRecord = { id: this.#id(), type: 'binding', connectorId, end, elementId: at, anchor: anchor ?? { kind: 'floating' } };
    this.#add(binding);
    return undefined;
  }

  screen(o: ScreenOptions = {}): RecordId {
    const s: ScreenRecord = {
      id: this.#id(),
      type: 'screen',
      index: this.#index('screens'),
      ...(o.name === undefined ? {} : { name: o.name }),
      ...(o.size === undefined ? {} : { size: o.size }),
      ...(o.kind === undefined ? {} : { kind: o.kind }),
      ...(o.viewport === undefined ? {} : { viewport: o.viewport }),
    };
    return this.#add(s);
  }

  rect(screenId: RecordId, o: RectOptions = {}): RecordId {
    const label = o.label === undefined ? {} : { text: plainText(o.label) };
    const shape: ShapeElement = {
      ...this.#placed(screenId, o.parentId),
      kind: 'shape',
      defId: o.defId ?? 'basic:rect',
      transform: box(o),
      ...label,
      ...extras(o),
    };
    return this.#add(shape);
  }

  text(screenId: RecordId, text: string, o: RectOptions = {}): RecordId {
    const t: TextElement = { ...this.#placed(screenId, o.parentId), kind: 'text', transform: box(o), text: plainText(text), ...extras(o) };
    return this.#add(t);
  }

  connect(from: RecordId | Point, to: RecordId | Point, o: ConnectOptions = {}): RecordId {
    const placed = this.#placed(this.#screenOf(from, to), undefined);
    const freeSource = this.#end(placed.id, 'source', from, o.sourceAnchor);
    const freeTarget = this.#end(placed.id, 'target', to, o.targetAnchor);
    const connector: ConnectorElement = {
      ...placed,
      kind: 'connector',
      route: { type: o.route ?? 'straight' },
      ...(o.arrow === false ? {} : { markers: { end: 'arrow' } }),
      ...(freeSource === undefined ? {} : { freeSource }),
      ...(freeTarget === undefined ? {} : { freeTarget }),
    };
    return this.#add(connector);
  }

  build(): DocumentFile {
    return { schemaVersion: SCHEMA_VERSION, records: { ...this.#records } };
  }
}

/**
 * Start a document with a `document` record.
 *
 * @param options - title and the seed of the ID sequence (default 1)
 * @public
 */
export function documentBuilder(options: { readonly title?: string; readonly seed?: number } = {}): DocumentBuilder {
  return new Builder(options.seed ?? 1, options.title);
}
