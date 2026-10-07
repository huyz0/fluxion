// The `element` record and its kinds (02-document-model §2 "Element kinds", FR-SHP-001, FR-CON-001).
// Every element has a screen, a z-order index and a kind; the kind decides the extra fields.
import type { IndexKey } from '../fractional-index.js';
import type { RecordId } from '../ids.js';
import type { Extensible, Meta } from '../primitives.js';
import type { RichTextDoc } from '../rich-text.js';
import type { AnchorDef, BoxedBase, ElementBase, Point, QualifiedName } from './element-base.js';
import type { LayoutSpec } from './layout-spec.js';

/**
 * How a shape's text fits its region (FR-SHP-006, ADR-0018). Alignment is `style.font`'s.
 *
 * @public
 */
export type TextFit = Extensible<{
  /** `none`: the text keeps its size; `shrink`: its size falls until it fits; `grow`: the shape's height rises to fit it (applied by the command that edits the text). Default `none`. */
  readonly mode?: 'none' | 'shrink' | 'grow';
  /** Space between the text region's edges and the text, in px (default 8). */
  readonly padding?: number;
  /** The smallest size `shrink` goes to, in px (default 8). */
  readonly minSize?: number;
  /** Text that does not fit: drawn beyond the region (`visible`, the default) or cut at it (`clip`). */
  readonly overflow?: 'visible' | 'clip';
}>;

/**
 * A shape drawn from a shape definition (FR-SHP-001).
 *
 * @public
 */
export type ShapeElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'shape';
    /** Shape definition, e.g. `basic:rect`. */
    readonly defId: QualifiedName;
    /** Definition parameters (validated by the definition when loaded). */
    readonly params?: { readonly [key: string]: unknown };
    /** Instance-specific anchors in addition to the definition's. */
    readonly anchors?: readonly AnchorDef[];
    /** How the text fits its region (ADR-0018). */
    readonly textFit?: TextFit;
  }
>;

/**
 * A connector's route intent.
 *
 * @public
 */
export type Route = Extensible<{
  /** Routing style, or a plugin router `<namespace>:<name>`. */
  readonly type: 'straight' | 'curved' | 'orthogonal' | 'polyline' | QualifiedName;
  /** Points the route passes through. */
  readonly waypoints?: readonly Point[];
  /** Corner rounding of orthogonal routes, px. */
  readonly cornerRadius?: number;
}>;

/**
 * End decorations of a connector: `none`, `arrow`, `triangle`, `circle`, `diamond`, `bar`, or a
 * plugin marker `<namespace>:<name>`.
 *
 * @public
 */
export type Marker = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar' | QualifiedName;

/**
 * Markers at the start, end and middle of a connector.
 *
 * @public
 */
export type Markers = Extensible<{
  /** At the source end. */
  readonly start?: Marker;
  /** At the target end. */
  readonly end?: Marker;
  /** At the midpoint. */
  readonly mid?: Marker;
}>;

/**
 * A label placed along a connector.
 *
 * @public
 */
export type ConnectorLabel = Extensible<{
  /** Label text. */
  readonly text: RichTextDoc;
  /** Position along the route, 0 (source) to 1 (target). */
  readonly position: number;
  /** Offset from the route in px. */
  readonly offset?: Point;
}>;

/**
 * A connector (FR-CON-001): each end is bound through a `binding` record or free at a point.
 *
 * @public
 */
export type ConnectorElement = Extensible<
  ElementBase & {
    /** Element kind. */
    readonly kind: 'connector';
    /** Route intent. */
    readonly route: Route;
    /** End decorations. */
    readonly markers?: Markers;
    /** Labels along the route. */
    readonly labels?: readonly ConnectorLabel[];
    /** Source point when the source end has no binding. */
    readonly freeSource?: Point;
    /** Target point when the target end has no binding. */
    readonly freeTarget?: Point;
  }
>;

/**
 * A group: children refer to it with `parentId`.
 *
 * @public
 */
export type GroupElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'group';
    /** How the group lays out its `auto` members (schema 1.3, ADR-0031). */
    readonly layout?: LayoutSpec;
  }
>;

/**
 * A frame: a clipping container with padding.
 *
 * @public
 */
export type FrameElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'frame';
    /** Clip children to the frame box. */
    readonly clip?: boolean;
    /** Inner padding in px. */
    readonly padding?: number;
    /** How the frame lays out its `auto` children (schema 1.3, ADR-0031). */
    readonly layout?: LayoutSpec;
  }
>;

/**
 * A text box.
 *
 * @public
 */
export type TextElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'text';
    /** The text. */
    readonly text: RichTextDoc;
    /** Grow the box to fit the text: `none`, `width` or `height`. */
    readonly autoSize?: 'none' | 'width' | 'height';
  }
>;

/**
 * A crop rectangle in fractions of the image (0–1).
 *
 * @public
 */
export type Crop = Extensible<{
  /** Left edge, 0–1. */
  readonly x: number;
  /** Top edge, 0–1. */
  readonly y: number;
  /** Width, 0–1. */
  readonly w: number;
  /** Height, 0–1. */
  readonly h: number;
}>;

/**
 * An image from a document asset.
 *
 * @public
 */
export type ImageElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'image';
    /** The `asset` record holding the bytes. */
    readonly assetId: RecordId;
    /** Visible part of the image. */
    readonly crop?: Crop;
    /** How the image fills the box (default `contain`). */
    readonly fit?: 'cover' | 'contain' | 'fill';
    /** Shape definition used as a mask. */
    readonly maskDefId?: QualifiedName;
  }
>;

/**
 * A plugin component instance (R6).
 *
 * @public
 */
export type ComponentElement = Extensible<
  BoxedBase & {
    /** Element kind. */
    readonly kind: 'component';
    /** Component id `<plugin>:<name>`. */
    readonly componentId: QualifiedName;
    /** Component props (validated by the component when loaded). */
    readonly props: { readonly [key: string]: unknown };
    /** Rendered snapshot shown when the component cannot run. */
    readonly snapshotAssetId?: RecordId;
  }
>;

/**
 * An element of a plugin kind `<plugin>:<name>`; kept verbatim when the plugin is not loaded
 * (FR-DOC-005).
 *
 * @public
 */
export type PluginElement = Extensible<
  BoxedBase & {
    /** Plugin element kind. */
    readonly kind: QualifiedName;
    /** Plugin data (validated by the plugin's schema when loaded). */
    readonly props?: { readonly [key: string]: unknown };
  }
>;

/**
 * Any element.
 *
 * @public
 */
export type ElementRecord = ShapeElement | ConnectorElement | GroupElement | FrameElement | TextElement | ImageElement | ComponentElement | PluginElement;

/**
 * An element whose kind this version does not know and that is not a plugin kind (from a newer
 * minor version); only its envelope is checked, the rest is kept (FR-DOC-005).
 *
 * @public
 */
export type UnknownElement = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'element';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The screen the element is on. */
  readonly screenId: RecordId;
  /** The containing element, if any. */
  readonly parentId?: RecordId;
  /** Z-order among its siblings. */
  readonly index: IndexKey;
  /** The unknown kind. */
  readonly kind: string;
}>;

/**
 * A core element kind.
 *
 * @public
 */
export type CoreElementKind = 'shape' | 'connector' | 'group' | 'frame' | 'text' | 'image' | 'component';

/**
 * The core element kinds.
 *
 * @public
 */
export const ELEMENT_KINDS: readonly CoreElementKind[] = ['shape', 'connector', 'group', 'frame', 'text', 'image', 'component'];

/**
 * Whether `kind` is a core element kind.
 *
 * @public
 */
export function isCoreElementKind(kind: unknown): kind is CoreElementKind {
  return typeof kind === 'string' && (ELEMENT_KINDS as readonly string[]).includes(kind);
}
