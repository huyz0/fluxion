// Render-level registries (03-core-engine §4, 04 §2.2, FR-EXT-001): element views by kind, and the
// host's core `shapeDefs` registry (ADR-0016, ADR-0017), looked up here and never switched on;
// built-ins register through the same API as plugins.
import { createRegistry, type Registry, type ShapeDef, type Store } from '@fluxion/core';
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
  /**
   * The theme styles resolve against. Its colour values may lag a colour-only change: they reach the
   * view as CSS variables the screen defines, so draw colours from resolved styles (`var(--fx-…)`),
   * never from token values (ADR-0015 amendment, M5.13). A view needs an ancestor carrying
   * `toCssVars(theme)` (`<ScreenView>`'s `.fx-screen`).
   */
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
 * The render-level registries.
 *
 * @public
 */
export type RenderRegistries = {
  /** Element views by element kind (`shape`, `connector`, `<plugin>:<name>`, …). */
  readonly elementViews: Registry<string, ElementView>;
  /** Shape definitions by id (`basic:rect`, …): the host's core registry, where packs register. */
  readonly shapeDefs: Registry<string, ShapeDef>;
};

/**
 * Render registries with no element views, reading shape definitions from `shapeDefs` (a host's core
 * registry, holding its packs; default: a fresh empty one).
 *
 * @public
 */
export function createRenderRegistries(shapeDefs: Registry<string, ShapeDef> = createRegistry<string, ShapeDef>('shapeDefs')): RenderRegistries {
  return { elementViews: createRegistry<string, ElementView>('elementViews'), shapeDefs };
}
