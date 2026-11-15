// Master screens (FR-SCR-005, ADR-0054): which master applies to a screen and what it draws there, as a view derived from the
// records, so a change to a master shows on every screen that uses it. A master applies only when the target is a master
// (`role: 'master'`), names no master itself (one level), and both screens are fixed with the same size; otherwise the screen
// draws without it and the problem says why. A screen's own background and theme win over the master's; the master's elements
// draw beneath the screen's own, its placeholders only where a screen element does not fill them (and then in edit mode alone,
// which render decides). Pure.
import { type Paint, type RecordId, type ScreenRecord, screenKind, screenSize } from '@fluxion/schema';
import type { ReadView } from './store.js';

/**
 * Why a screen's `masterId` draws nothing: the target is no master screen, it names a master itself, either screen is
 * infinite, or their sizes differ.
 *
 * @public
 */
export type MasterProblemCode = 'not-master' | 'chain' | 'infinite' | 'size';

/**
 * The master a screen draws: its id, or why the one it names does not apply (none when it names none).
 *
 * @public
 */
export type AppliedMaster = {
  /** The master screen that applies. */
  readonly master?: RecordId;
  /** Why the named master does not apply. */
  readonly problem?: MasterProblemCode;
};

/**
 * What a master draws on a screen it applies to.
 *
 * @public
 */
export type MasterLayers = {
  /** The master screen. */
  readonly master: RecordId;
  /** The background the screen draws: its own, else the master's (none when neither has one). */
  readonly background?: Paint;
  /** The theme the screen draws with when it names none itself: the master's override. */
  readonly themeId?: RecordId;
  /** Whether the master's elements are drawn (not with `hideMasterElements`). */
  readonly elements: boolean;
  /** Every placeholder of the master: none of them draws as a master element. */
  readonly placeholders: ReadonlySet<RecordId>;
  /** The visible placeholders no element of the screen fills: drawn as hints in edit mode only. */
  readonly unfilled: readonly RecordId[];
};

type Placed = { readonly type?: unknown; readonly placeholder?: unknown; readonly fills?: unknown; readonly hidden?: unknown };

const screenOf = (view: ReadView, id: RecordId | undefined): ScreenRecord | undefined => {
  const r = id === undefined ? undefined : view.get(id);
  return r?.type === 'screen' ? (r as ScreenRecord) : undefined;
};

/**
 * Whether `record` is a master screen.
 *
 * @public
 */
export function isMasterScreen(record: { readonly type?: unknown; readonly role?: unknown } | undefined): boolean {
  return record?.type === 'screen' && record.role === 'master';
}

/** Why `target` cannot be `screen`'s master, if it cannot. */
function refusal(screen: ScreenRecord, target: ScreenRecord | undefined): MasterProblemCode | undefined {
  if (target === undefined || !isMasterScreen(target)) return 'not-master';
  if (target.masterId !== undefined || isMasterScreen(screen)) return 'chain';
  if (screenKind(screen) === 'infinite' || screenKind(target) === 'infinite') return 'infinite';
  const [a, b] = [screenSize(screen), screenSize(target)];
  return a.w === b.w && a.h === b.h ? undefined : 'size';
}

/**
 * The master that applies to the screen `screenId`, or why the one it names does not (ADR-0054's rules).
 *
 * @public
 */
export function appliedMaster(view: ReadView, screenId: RecordId): AppliedMaster {
  const screen = screenOf(view, screenId);
  if (screen?.masterId === undefined) return {};
  const problem = refusal(screen, screenOf(view, screen.masterId));
  return problem === undefined ? { master: screen.masterId } : { problem };
}

/**
 * The elements of the master screen `masterId` that are placeholders, at any depth.
 *
 * @public
 */
export function placeholdersOf(view: ReadView, masterId: RecordId): RecordId[] {
  return view.members('byScreen', masterId).filter((id) => typeof (view.get(id) as Placed | undefined)?.placeholder === 'string');
}

/** The placeholders the elements of `screenId` fill. */
function filledOn(view: ReadView, screenId: RecordId): Set<RecordId> {
  return new Set(
    view.members('byScreen', screenId).flatMap((id) => {
      const fills = (view.get(id) as Placed | undefined)?.fills;
      return typeof fills === 'string' ? [fills as RecordId] : [];
    }),
  );
}

/**
 * What the applied master of `screenId` draws there; undefined when no master applies.
 *
 * @public
 */
export function masterLayers(view: ReadView, screenId: RecordId): MasterLayers | undefined {
  const { master } = appliedMaster(view, screenId);
  const [screen, target] = [screenOf(view, screenId), screenOf(view, master)];
  if (master === undefined || screen === undefined || target === undefined) return undefined;
  const placeholders = placeholdersOf(view, master);
  const filled = filledOn(view, screenId);
  const background = screen.background ?? target.background;
  const themeId = (target as { themeId?: RecordId }).themeId;
  const elements = screen.hideMasterElements !== true;
  return {
    master,
    ...(background === undefined ? {} : { background }),
    ...(themeId === undefined ? {} : { themeId }),
    elements,
    placeholders: new Set(placeholders),
    unfilled: elements ? placeholders.filter((id) => !filled.has(id) && (view.get(id) as Placed).hidden !== true) : [],
  };
}

const sameSet = (a: ReadonlySet<RecordId>, b: ReadonlySet<RecordId>) => a.size === b.size && [...a].every((id) => b.has(id));
const sameList = (a: readonly RecordId[], b: readonly RecordId[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Whether two {@link MasterLayers} draw the same: what lets a view keep the one it has while a screen's own elements move (a drag
 * redraws the dragged element, not the master layer: ADR-0028 §4).
 *
 * @public
 */
export function sameMasterLayers(a: MasterLayers | undefined, b: MasterLayers | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.master === b.master &&
    JSON.stringify(a.background) === JSON.stringify(b.background) &&
    a.themeId === b.themeId &&
    a.elements === b.elements &&
    sameSet(a.placeholders, b.placeholders) &&
    sameList(a.unfilled, b.unfilled)
  );
}

/**
 * The screens the master `masterId` applies to: what a change to it redraws.
 *
 * @public
 */
export function dependentsOf(view: ReadView, masterId: RecordId): RecordId[] {
  return view.members('byType', 'screen').filter((id) => appliedMaster(view, id).master === masterId);
}

/**
 * The elements of `screenId` whose `fills` names no placeholder of its applied master: they draw as ordinary elements.
 *
 * @public
 */
export function strayFills(view: ReadView, screenId: RecordId): RecordId[] {
  const { master } = appliedMaster(view, screenId);
  const placeholders = new Set(master === undefined ? [] : placeholdersOf(view, master));
  return view.members('byScreen', screenId).filter((id) => {
    const fills = (view.get(id) as Placed | undefined)?.fills;
    return typeof fills === 'string' && !placeholders.has(fills as RecordId);
  });
}

/**
 * The placeholders of the master `masterId` that share a name with another, by name (each list two or more long, in id order):
 * reported, and each still fillable by its id.
 *
 * @public
 */
export function sharedPlaceholderNames(view: ReadView, masterId: RecordId): ReadonlyMap<string, readonly RecordId[]> {
  const byName = new Map<string, RecordId[]>();
  for (const id of placeholdersOf(view, masterId).sort()) {
    const name = (view.get(id) as Placed).placeholder as string;
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  return new Map([...byName].filter(([, ids]) => ids.length > 1));
}
