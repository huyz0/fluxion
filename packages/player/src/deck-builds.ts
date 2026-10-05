// The build groups of a screen, read from the document (FR-PRS-003): the steps of the screen's `main` timeline in order, folded by `@fluxion/anim`. Timelines
// other than `main` are named timelines played by actions and are not part of the build position (07 §2).

import { type BuildStep, type Builds, compileBuilds, reduceBuild } from '@fluxion/anim';
import type { ReadView } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';

type Ordered = { readonly index?: unknown };
type TimelineLike = { readonly type?: unknown; readonly screenId?: unknown; readonly name?: unknown };
type StepLike = Ordered & {
  readonly type?: unknown;
  readonly timelineId?: unknown;
  readonly trigger?: { readonly kind?: unknown };
  readonly animations?: readonly { readonly effect?: unknown; readonly targets?: unknown }[];
};

const byIndex = (a: Ordered, b: Ordered): number =>
  String(a.index ?? '') < String(b.index ?? '') ? -1 : String(a.index ?? '') > String(b.index ?? '') ? 1 : 0;

/** The steps of `screenId`'s main timeline, in the timeline's order, as the builds read them. */
function mainSteps(view: ReadView, screenId: RecordId): BuildStep<RecordId>[] {
  const timelines = new Set(
    view.members('byType', 'timeline').filter((id) => {
      const t = view.get(id) as TimelineLike | undefined;
      return t?.screenId === screenId && t.name === 'main';
    }),
  );
  return view
    .members('byType', 'step')
    .map((id) => ({ id, record: view.get(id) as StepLike | undefined }))
    .filter((e): e is { id: RecordId; record: StepLike } => e.record !== undefined && timelines.has(e.record.timelineId as RecordId))
    .sort((a, b) => byIndex(a.record, b.record) || (a.id < b.id ? -1 : 1))
    .map(({ id, record }) => ({
      id,
      trigger: { kind: String(record.trigger?.kind ?? '') },
      animations: (record.animations ?? []).map((a) => ({
        effect: String(a.effect ?? ''),
        targets: (Array.isArray(a.targets) ? a.targets : []).filter((t): t is RecordId => typeof t === 'string'),
      })),
    }));
}

/**
 * The builds of screen `screenId`: its main timeline's steps folded into the groups the presentation clicks through.
 *
 * @public
 */
export function buildsOfScreen(view: ReadView, screenId: RecordId): Builds<RecordId> {
  return compileBuilds(mainSteps(view, screenId));
}

/**
 * The elements screen `screenId` leaves out once `group` of its build groups have played (0: before any, its click count: complete).
 *
 * @public
 */
export function hiddenAt(view: ReadView, screenId: RecordId, group: number): ReadonlySet<RecordId> {
  return reduceBuild(buildsOfScreen(view, screenId), group).hidden;
}
