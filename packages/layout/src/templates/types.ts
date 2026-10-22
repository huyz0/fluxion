// The smart template contract (FR-LAY-014, ADR-0047): a template builds shapes and connectors from an items list, in frame space. The result is
// drafts, not records: the editor's `template.apply`, the DSL compiler and the AI patch turn them into records. Pure: the text is measured
// through the injected port, styles are theme tokens and a variant per slot role, so a theme restyles a template without a colour in it.
import type { FontSpec, TextMeasurer } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import type { ZodType } from 'zod';

/**
 * One item a template is built from: a label, an optional detail line and, for the templates that nest (`hierarchy.org`), children. The
 * same shape as `@fluxion/schema`'s `TemplateItem`, which a `template` layout spec stores.
 *
 * @public
 */
export type TemplateItem = {
  /** The item's text. */
  readonly label: string;
  /** A second, smaller line. */
  readonly detail?: string;
  /** Nested items. */
  readonly children?: readonly TemplateItem[];
};

/**
 * A slot of a template: the shape its elements are drawn with and the role a theme styles them by (its `variant`).
 *
 * @public
 */
export type TemplateSlot = {
  /** A `shapeDefs` id, such as `basic:rounded-rect`. */
  readonly shape: string;
  /** The theme variant the slot's elements and connectors carry. */
  readonly role: string;
};

/**
 * What a template builds in: the frame it fills, the text measurer slots grow by, and the font labels are measured in.
 *
 * @public
 */
export type TemplateContext = {
  /** The box to fill, in screen space. */
  readonly frame: Box;
  /** Measures labels, so a slot grows to fit its text. */
  readonly measure: TextMeasurer;
  /** The labels' font (default: the theme's body font, 20 px). */
  readonly font?: FontSpec;
};

/**
 * The style a built element or connector carries: theme tokens and the slot's variant, nothing a theme cannot override.
 *
 * @public
 */
export type TemplateStyle = {
  /** The slot role, a theme variant. */
  readonly variant: string;
  /** A fill token, such as `{color.accent-1}`; absent for a connector. */
  readonly fill?: string;
  /** The stroke. */
  readonly stroke: {
    /** A colour token. */
    readonly color: string;
    /** Its width, px (0: none). */
    readonly width: number;
  };
  /** The shape's opacity, 0 to 1, where shapes are meant to show through each other (`venn`); absent for opaque. */
  readonly opacity?: number;
  /** The label's font; absent for a connector. */
  readonly font?: {
    /** The label colour token. */
    readonly color: string;
  };
};

/**
 * A shape a template builds.
 *
 * @public
 */
export type TemplateShapeDraft = {
  /** Unique within the result; connectors refer to it. */
  readonly key: string;
  /** The slot it fills. */
  readonly slot: string;
  /** The item it shows: its index in a depth-first walk of the items. */
  readonly index: number;
  /** A `shapeDefs` id. */
  readonly shape: string;
  /** Its box, in screen space. */
  readonly box: Box;
  /** The shape's own parameters (`basic:trapezoid`'s `inset`), when it has any. */
  readonly params?: { readonly [name: string]: number };
  /** The label. */
  readonly label: string;
  /** The detail line. */
  readonly detail?: string;
  /** The style. */
  readonly style: TemplateStyle;
};

/**
 * A connector a template builds, between two of its shapes.
 *
 * @public
 */
export type TemplateConnectorDraft = {
  /** Unique within the result. */
  readonly key: string;
  /** The slot it fills. */
  readonly slot: string;
  /** The key of the shape it starts at. */
  readonly from: string;
  /** The key of the shape it ends at. */
  readonly to: string;
  /** The style. */
  readonly style: TemplateStyle;
};

/**
 * What a template builds: shapes, then the connectors between them.
 *
 * @public
 */
export type TemplateResult = {
  /** The shapes, in item order. */
  readonly shapes: readonly TemplateShapeDraft[];
  /** The connectors. */
  readonly connectors: readonly TemplateConnectorDraft[];
};

/**
 * A smart template (ADR-0047): a registry entry under its id that builds shapes and connectors from an items list.
 *
 * @public
 */
export type TemplateDef<O> = {
  /** The registry id: `process.chevron`, or `<pack>:<name>` for a pack's. */
  readonly id: string;
  /** One line for the AI catalog and the picker. */
  readonly describe: string;
  /** Bumped when the same input builds something else. */
  readonly version: string;
  /** The items it takes (how many, how deep). */
  readonly items: ZodType<readonly TemplateItem[]>;
  /** Its options, defaults filled in. */
  readonly schema: ZodType<O>;
  /** Its slots by name. */
  readonly slots: { readonly [slot: string]: TemplateSlot };
  /** Build from checked items and options. */
  build(items: readonly TemplateItem[], options: O, ctx: TemplateContext): TemplateResult;
  /** The options for a frame of this shape, such as a vertical process in a portrait frame. */
  adapt?(frame: Box, options: O): O;
};
