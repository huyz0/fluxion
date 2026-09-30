// What hit-testing works with (FR-EDT-004): the context it reads besides the store, and an element as
// it sees it. Shared by the index (hit-test.ts) and the per-kind tests (connector-hit.ts).
import type { MarkerDef, Registry } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RouteContext } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';

/**
 * What hit-testing reads besides the store: shape definitions, routers and markers (render's
 * registries have them all), and the theme styles resolve against.
 *
 * @public
 */
export type HitContext = {
  /** Shape definitions and connector routers; markers, when connectors' markers are hit too. */
  readonly registries: RouteContext & {
    /** Marker definitions: a connector's registered markers are hit where they are drawn. */
    readonly markers?: Registry<string, MarkerDef>;
  };
  /** The theme element styles resolve against (a new theme needs a new index). */
  readonly theme: Theme;
};

/** An element as hit-testing sees it: its drawn bounds and an exact test in page coordinates. */
export type Hittable = {
  readonly screenId: RecordId;
  /** Drawn bounds, stroke included. */
  readonly bounds: Box;
  /** Whether `p` hits it, with `tolerance` page units of margin. */
  hits(p: Vec2, tolerance: number): boolean;
  /** Whether the page box `box` touches what is drawn (a marquee). */
  touches(box: Box): boolean;
};

/** What hit-testing resolves styles with: the context, and the theme's CSS variables. */
export type Resolving = HitContext & { readonly vars: { readonly [name: string]: string | undefined } };

/** Whether `l` is within `box`, or `tolerance` of it. */
export const inBox = (l: Vec2, box: Box, tolerance: number): boolean =>
  // tzap disable next-line EqualityOperator: a point exactly at the margin's edge
  l.x >= box.x - tolerance && l.y >= box.y - tolerance && l.x <= box.x + box.w + tolerance && l.y <= box.y + box.h + tolerance;
