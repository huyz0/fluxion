// The FluxScript tree after the read stage (ADR-0030): what R2 compiles, typed and located; what it defers, kept as source text by
// pointer for `document.source.deferred` (ADR-0031).
import type { Edge } from '../parse/edge.js';
import type { SourceRange } from '../types.js';

/**
 * A value with the source range it was read from.
 *
 * @public
 */
export type Located<T> = {
  /** The value. */
  readonly value: T;
  /** Where it is. */
  readonly range: SourceRange;
};

/**
 * A node: a shape or text element named by its slug.
 *
 * @public
 */
export type NodeAst = {
  /** The slug, unique in the document. */
  readonly slug: Located<string>;
  /** A shape name, short (`rect`) or qualified (`basic:rect`). */
  readonly shape?: Located<string>;
  /** Text content (a text element when there is no shape). */
  readonly text?: Located<string>;
  /** The label shown in the shape. */
  readonly label?: Located<string>;
  /** A theme variant (`accent`). */
  readonly tone?: Located<string>;
  /** Element style: token names by key, or a stroke preset. */
  readonly style?: Located<StyleAst>;
  /** A pinned box. */
  readonly pin?: Located<PinAst>;
  /** Alternative text. */
  readonly alt?: Located<string>;
};

/**
 * A pinned box in screen units: its place, and its size when given.
 *
 * @public
 */
export type PinAst = {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, when given. */
  readonly w?: number;
  /** Height, when given. */
  readonly h?: number;
};

/**
 * A style: token names (or plain values) by style key, or a stroke preset.
 *
 * @public
 */
export type StyleAst = { readonly [key: string]: string | number | boolean } | 'solid' | 'dashed' | 'dotted';

/**
 * A layout intent: a `layouts` registry name and its own options.
 *
 * @public
 */
export type LayoutAst = {
  /** The `layouts` registry name. */
  readonly type: Located<string>;
  /** The layout's own options (every key of the spec but `type`). */
  readonly options: { readonly [key: string]: unknown };
};

/**
 * A group: a container of nodes.
 *
 * @public
 */
export type GroupAst = {
  /** The slug, unique in the document. */
  readonly slug: Located<string>;
  /** Its label. */
  readonly label?: Located<string>;
  /** The slugs of its members. */
  readonly contains: readonly Located<string>[];
  /** Its style. */
  readonly style?: Located<StyleAst>;
  /** How it lays out its members. */
  readonly layout?: LayoutAst;
};

/**
 * An edge.
 *
 * @public
 */
export type EdgeAst = {
  /** Its ends and op. */
  readonly edge: Edge;
  /** Where the edge is written. */
  readonly range: SourceRange;
  /** Its label. */
  readonly label?: Located<string>;
  /** Its style. */
  readonly style?: Located<StyleAst>;
  /** Its route type. */
  readonly route?: Located<'straight' | 'curved' | 'orthogonal' | 'polyline'>;
};

/**
 * A screen.
 *
 * @public
 */
export type ScreenAst = {
  /** Its id. */
  readonly id: Located<string>;
  /** Its title. */
  readonly title?: Located<string>;
  /** Its layout. */
  readonly layout?: LayoutAst;
  /** Its background: a colour or a token name. */
  readonly background?: Located<string>;
  /** Its nodes, in source order. */
  readonly nodes: readonly NodeAst[];
  /** Its groups, in source order. */
  readonly groups: readonly GroupAst[];
  /** Its edges, in source order. */
  readonly edges: readonly EdgeAst[];
  /** Speaker notes. */
  readonly notes?: Located<string>;
  /** Where the screen is written. */
  readonly range: SourceRange;
};

/**
 * A theme: a preset or a name, and token overrides.
 *
 * @public
 */
export type ThemeAst = {
  /** The preset or theme name. */
  readonly name?: Located<string>;
  /** Token values by token name. */
  readonly overrides: { readonly [token: string]: string | number };
};

/**
 * A read FluxScript file.
 *
 * @public
 */
export type FluxAst = {
  /** The document title. */
  readonly title?: Located<string>;
  /** The theme: a preset or a name, and token overrides. */
  readonly theme?: ThemeAst;
  /** The packs shapes are looked up in, in order. */
  readonly uses: readonly Located<string>[];
  /** The screens, in order. */
  readonly screens: readonly ScreenAst[];
  /** The source text of each section kept but not compiled, by pointer (`/vars`, `/screens/arch/steps`). */
  readonly deferred: { readonly [pointer: string]: string };
};
