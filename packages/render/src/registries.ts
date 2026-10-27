// Render-level registries (03-core-engine §4, 04 §2.2, FR-EXT-001): element views by kind, the
// host's core `shapeDefs` registry (ADR-0016, ADR-0017), its `routers` (FR-RTE-001) and `markers`
// (FR-CON-003), looked up here
// and never switched on; built-ins register through the same API as plugins.
import {
  type ArtworkFontBinding,
  createRegistry,
  type MarkerDef,
  type ReadSignal,
  type ReadView,
  type Registry,
  type ShapeDef,
  type Store,
} from '@fluxion/core';
import type { GlobalRoute, GlobalRouteInput, RouteContext, Router } from '@fluxion/routing';
import type { ElementRecord } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import type { ComponentType, ReactNode } from 'react';

/**
 * What an element view receives.
 *
 * @public
 */
export type ElementViewProps = {
  /**
   * The element to draw. A move (its box's `x` and `y` alone) does not draw the view again: the wrapper
   * places it, so draw in the box's own coordinates (`w`, `h`), never from its place (ADR-0028 §4).
   */
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
  /**
   * The words a screen reader gets for what the view draws without words (an image's alt text, a connector's relation as "A connects to B: label"), or nothing.
   * Pure; read through the store's tracked view, so the text follows the records. It is drawn visually hidden beside the view (NFR-A11Y-002).
   */
  readonly a11y?: (element: ElementRecord, view: ReadView) => string | undefined;
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
  /** Routers by route type (`straight`, `<plugin>:<name>`, …): a connector view routes with its type's. */
  readonly routers: Registry<string, Router>;
  /** Connector end markers by id (`arrow`, `<plugin>:<name>`, …): a connector view draws its ends' markers. */
  readonly markers: Registry<string, MarkerDef>;
  /**
   * The global routing pass's routes while they are current (FR-RTE-003; routing's `RouteContext.refined`), from a host that runs the pass
   * elsewhere (the studio's worker).
   */
  readonly refined?: RouteContext['refined'];
  /**
   * The pure global routing pass (routing's `globalRoutes`) from a batch host (the CLI, the exporters), once it has it: the views then run it
   * themselves, on the rendering thread (`withSettledRoutes`, M16.28). A page hands in `refined` from a worker instead (the studio, the
   * one-file player): the pass would block it. Without either, the cheap routes are drawn.
   */
  readonly globalPass?: ReadSignal<GlobalPass | undefined>;
  /**
   * Private-alias bindings of saved artwork text by definition id (ADR-0192, M18.97), written by
   * `registerVersionedShapePackSubsets` once the host has loaded the exact bytes. A bound
   * definition's text is drawn in its aliases only; without this registry, artwork draws as saved.
   */
  readonly artworkFonts?: Registry<string, readonly ArtworkFontBinding[]>;
};

/**
 * The global routing pass as a function of one screen's input (routing's `globalRoutes`): a host hands it to the views, which never import
 * it (NFR-SIZE-001: the player's script would carry it).
 *
 * @public
 */
export type GlobalPass = (input: GlobalRouteInput) => readonly GlobalRoute[];

/**
 * Render registries with no element views, reading shape definitions from `shapeDefs`, routers from
 * `routers` and markers from `markers` (a host's core registries, holding its packs; default: fresh
 * empty ones), and artwork font bindings from `artworkFonts` when the host registers saved 1.1 packs.
 *
 * @public
 */
export function createRenderRegistries(
  shapeDefs: Registry<string, ShapeDef> = createRegistry<string, ShapeDef>('shapeDefs'),
  routers: Registry<string, Router> = createRegistry<string, Router>('routers'),
  markers: Registry<string, MarkerDef> = createRegistry<string, MarkerDef>('markers'),
  artworkFonts?: Registry<string, readonly ArtworkFontBinding[]>,
): RenderRegistries {
  return { elementViews: createRegistry<string, ElementView>('elementViews'), shapeDefs, routers, markers, ...(artworkFonts ? { artworkFonts } : {}) };
}
