// Shared parts of the element kinds (02-document-model §2): names, points, semantics, locks,
// instance anchors and the base fields every element has. The kinds are in element.ts.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { IndexKey } from '../fractional-index.js';
import type { RecordId } from '../ids.js';
import { type Extensible, finite, type Meta } from '../primitives.js';
import type { RichTextDoc } from '../rich-text.js';
import type { Style, Transform } from '../style.js';

/**
 * A namespaced identifier `<namespace>:<name>`, e.g. `basic:rect` or `acme:chart`.
 *
 * @public
 */
export type QualifiedName = `${string}:${string}`;

const QUALIFIED = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9.-]*$/;

/**
 * Schema of a `<namespace>:<name>` field.
 *
 * @public
 */
export const qualifiedNameSchema: z.ZodType<QualifiedName> = z.custom<QualifiedName>((v) => typeof v === 'string' && QUALIFIED.test(v), {
  message: 'expected "<namespace>:<name>" in lower case, e.g. "basic:rect"',
});

/**
 * A point in logical pixels.
 *
 * @public
 */
export type Point = Extensible<{
  /** Horizontal position. */
  readonly x: number;
  /** Vertical position. */
  readonly y: number;
}>;

/** Schema of a point. */
export const pointSchema: z.ZodType<Point> = checkedSchema<Point>()(z.looseObject({ x: finite, y: finite }));

/**
 * Meaning of an element for AI tools, FluxScript and accessibility.
 *
 * @public
 */
export type Semantic = Extensible<{
  /** Document-unique handle used by FluxScript, AI patches and MCP (`api`, `pay-detail`). */
  readonly slug?: string;
  /** Human label (also the accessible name when the element has no text). */
  readonly label?: string;
  /** Domain role, e.g. `service` or `database`. */
  readonly role?: string;
  /** Free tags. */
  readonly tags?: readonly string[];
}>;

/**
 * Editing locks of an element.
 *
 * @public
 */
export type Locks = Extensible<{
  /** Position cannot change. */
  readonly position?: boolean;
  /** Size cannot change. */
  readonly size?: boolean;
  /** Rotation cannot change. */
  readonly rotation?: boolean;
  /** Cannot be deleted. */
  readonly delete?: boolean;
  /** Content cannot be edited. */
  readonly edit?: boolean;
}>;

/**
 * An anchor declared on a shape instance (FR-ANC-002, fractional coordinates in the element box).
 *
 * @public
 */
export type AnchorDef = Extensible<{
  /** Anchor name, unique on the element. */
  readonly name: string;
  /** Horizontal position, 0 (left) to 1 (right). */
  readonly x: number;
  /** Vertical position, 0 (top) to 1 (bottom). */
  readonly y: number;
  /** Outward direction. */
  readonly dir?: Point;
  /** Whether connectors may start (`out`), end (`in`) or both here. */
  readonly role?: 'in' | 'out' | 'any';
  /** Maximum number of connectors on this anchor. */
  readonly max?: number;
}>;

/**
 * Fields every element kind has.
 *
 * @public
 */
export type ElementBase = {
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'element';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The screen the element is on. */
  readonly screenId: RecordId;
  /** The group, frame or container holding it; absent at the screen root. */
  readonly parentId?: RecordId;
  /** Z-order among its siblings (fractional index). */
  readonly index: IndexKey;
  /** Display name in the layers panel. */
  readonly name?: string;
  /** Visual style; unset fields come from the theme. */
  readonly style?: Style;
  /** Meaning for AI, FluxScript and accessibility. */
  readonly semantic?: Semantic;
  /** Editing locks. */
  readonly locks?: Locks;
  /** Key pairing elements across screens for magic move. */
  readonly matchKey?: string;
  /** `auto`: layout may move it; `pinned`: keep the stored position. */
  readonly placement?: 'auto' | 'pinned';
  /** Hidden elements are not rendered. */
  readonly hidden?: boolean;
};

/**
 * Fields of the element kinds that occupy a box (all but connectors).
 *
 * @public
 */
export type BoxedBase = ElementBase & {
  /** Position, size and rotation. */
  readonly transform: Transform;
  /** Text shown inside the element. */
  readonly text?: RichTextDoc;
};
