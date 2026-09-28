// Render-level registries (03-core-engine §4, 04 §2.2, FR-EXT-001): element views and shape outlines
// are looked up by kind or definition id here, never switched on; built-ins register through the
// same API as plugins.
import { createRegistry, type Registry, type Store } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import type { ElementRecord } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import type { ComponentType, ReactNode } from 'react';

/**
 * What an element view receives.
 *
 * @public
 */
export type ElementViewProps = {
  /** The element to draw. */
  readonly element: ElementRecord;
  /** The document store (for views that read related records, such as a connector's ends). */
  readonly store: Store;
  /** The theme styles resolve against. */
  readonly theme: Theme;
  /** The registries the view was looked up in (a shape view reads `shapeDefs`). */
  readonly registries: RenderRegistries;
  /** The element's children (a group's or frame's members), already wrapped and ordered. */
  readonly children?: ReactNode;
};

/**
 * How one element kind is drawn (04 §2.2). The view draws inside its `.fx-el` wrapper, which is
 * placed at the element's box.
 *
 * @public
 */
export type ElementView = {
  /** Draws the element; must be pure: the same record gives the same markup in every mode. */
  readonly Component: ComponentType<ElementViewProps>;
};

/**
 * The outline of a shape definition (03 §5), as the renderer needs it. In R0 render holds these
 * itself; the JSON `ShapeDef` of the core `shapeDefs` registry replaces them with the basic pack (M5).
 *
 * @public
 */
export type ShapeOutline = {
  /** The outline of a `w` × `h` shape, in its own box (origin at the top-left corner). */
  outline(size: {
    /** Width. */
    readonly w: number;
    /** Height. */
    readonly h: number;
  }): readonly PathCommand[];
};

/**
 * The render-level registries.
 *
 * @public
 */
export type RenderRegistries = {
  /** Element views by element kind (`shape`, `connector`, `<plugin>:<name>`, …). */
  readonly elementViews: Registry<string, ElementView>;
  /** Shape outlines by definition id (`basic:rect`, …). */
  readonly shapeDefs: Registry<string, ShapeOutline>;
};

/**
 * A fresh set of empty render registries.
 *
 * @public
 */
export function createRenderRegistries(): RenderRegistries {
  return { elementViews: createRegistry<string, ElementView>('elementViews'), shapeDefs: createRegistry<string, ShapeOutline>('shapeDefs') };
}
