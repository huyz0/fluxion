// Render-level registries (03-core-engine §4, 04 §2.2, FR-EXT-001): element views are looked up by
// kind here, never switched on; built-in views register through the same API as plugins.
import { createRegistry, type Registry, type Store } from '@fluxion/core';
import type { ElementRecord } from '@fluxion/schema';
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
};

/**
 * A fresh set of empty render registries.
 *
 * @public
 */
export function createRenderRegistries(): RenderRegistries {
  return { elementViews: createRegistry<string, ElementView>('elementViews') };
}
