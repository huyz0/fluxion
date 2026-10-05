// Build groups (FR-PRS-003, 07 §2 "Step semantics"): the steps of a screen's `main` timeline folded into the groups the presentation clicks through, and the state
// of the screen after any group. M11 knows two effects, `appear` and `disappear`, which decide whether an element is shown; the rest of the effects arrive in M21 and
// M22. Pure: ids and triggers go in as plain values, so the package takes no dependency on the record types.

/**
 * A step as the builds read it: its place in the timeline's order is the order of the array they are given.
 *
 * @public
 */
export type BuildStep<Id extends string = string> = {
  /** The step's record id. */
  readonly id: Id;
  /** When it runs. */
  readonly trigger: {
    /** `onEnter`, `onClick`, `withPrevious`, `afterPrevious`, `onEvent` or `onTime`. */
    readonly kind: string;
  };
  /** What it plays: an animation with effect `appear` or `disappear` shows or hides its targets; any other effect changes no visibility. */
  readonly animations: readonly {
    /** The effect's id. */
    readonly effect: string;
    /** The elements it acts on. */
    readonly targets: readonly Id[];
  }[];
};

/**
 * What a build effect does to its targets.
 *
 * @public
 */
export type BuildEffect<Id extends string = string> = {
  /** `appear` shows the targets from this group on, `disappear` hides them. */
  readonly kind: 'appear' | 'disappear';
  /** The elements it acts on. */
  readonly targets: readonly Id[];
};

/**
 * One group: the steps that play together, and the effects they have on visibility.
 *
 * @public
 */
export type BuildGroup<Id extends string = string> = {
  /** The steps of the group, in order. */
  readonly steps: readonly Id[];
  /** Their effects on visibility, in order. */
  readonly effects: readonly BuildEffect<Id>[];
};

/**
 * A screen's builds: group 0 plays on entry, groups 1 to `clicks` are the clicks.
 *
 * @public
 */
export type Builds<Id extends string = string> = {
  /** Group 0 (the `onEnter` steps) and then one group per click, gate and event. */
  readonly groups: readonly BuildGroup<Id>[];
  /** How many groups there are after group 0: the number of clicks a presentation of the screen takes. */
  readonly clicks: number;
  /** The elements hidden before anything plays: those whose first effect is `appear`. */
  readonly initiallyHidden: ReadonlySet<Id>;
};

/**
 * What the build has done to the screen at a group.
 *
 * @public
 */
export type BuildState<Id extends string = string> = {
  /** The elements the build hides now. */
  readonly hidden: ReadonlySet<Id>;
};

const ENTER = 'onEnter';
const FOLLOWS = new Set(['withPrevious', 'afterPrevious']);

/** The visibility effects of `step`, in order. */
function effectsOf<Id extends string>(step: BuildStep<Id>): BuildEffect<Id>[] {
  return step.animations.flatMap((a): BuildEffect<Id>[] => (a.effect === 'appear' || a.effect === 'disappear' ? [{ kind: a.effect, targets: a.targets }] : []));
}

/** The steps split into group 0 and the click groups: see {@link compileBuilds}. */
function groupSteps<Id extends string>(steps: readonly BuildStep<Id>[]): BuildStep<Id>[][] {
  const entering: BuildStep<Id>[] = [];
  const clicks: BuildStep<Id>[][] = [];
  for (const step of steps) {
    const kind = step.trigger.kind;
    const current = clicks.at(-1);
    if (kind === ENTER || (FOLLOWS.has(kind) && current === undefined)) entering.push(step);
    else if (FOLLOWS.has(kind) && current !== undefined) current.push(step);
    else clicks.push([step]);
  }
  return [entering, ...clicks];
}

/** The elements whose first effect, from group 0 on, is `appear`. */
function hiddenAtStart<Id extends string>(groups: readonly BuildGroup<Id>[]): Set<Id> {
  const first = new Map<Id, 'appear' | 'disappear'>();
  for (const { kind, targets } of groups.flatMap((g) => g.effects)) for (const target of targets) if (!first.has(target)) first.set(target, kind);
  return new Set([...first].filter(([, kind]) => kind === 'appear').map(([id]) => id));
}

/**
 * Fold `steps` (a timeline's steps in order) into groups. An `onEnter` step is in group 0 wherever it stands; `onClick`, `onEvent`, `onTime` and any trigger not
 * known here start a new group (a gate, passed by `next`); `withPrevious` and `afterPrevious` join the group before them, or group 0 when nothing came before.
 *
 * @public
 */
export function compileBuilds<Id extends string>(steps: readonly BuildStep<Id>[]): Builds<Id> {
  const members = groupSteps(steps);
  const groups = members.map((m): BuildGroup<Id> => ({ steps: m.map((s) => s.id), effects: m.flatMap(effectsOf) }));
  return { groups, clicks: groups.length - 1, initiallyHidden: hiddenAtStart(groups) };
}

/** Apply one effect to the hidden set. */
function apply<Id extends string>(hidden: Set<Id>, { kind, targets }: BuildEffect<Id>): void {
  for (const target of targets) {
    if (kind === 'appear') hidden.delete(target);
    else hidden.add(target);
  }
}

/**
 * The state after group `group` has played, from the start: the groups from 0 to `group` folded in order, so seeking never replays an animation (FR-TML-005).
 * A group past the last is the last; one before 0 is 0.
 *
 * @public
 */
export function reduceBuild<Id extends string>(builds: Builds<Id>, group: number): BuildState<Id> {
  const upTo = Math.min(Math.max(0, Number.isFinite(group) ? Math.trunc(group) : 0), builds.clicks);
  const hidden = new Set<Id>(builds.initiallyHidden);
  for (const effect of builds.groups.slice(0, upTo + 1).flatMap((g) => g.effects)) apply(hidden, effect);
  return { hidden };
}
