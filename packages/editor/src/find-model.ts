// Element search (FR-EDT-016): which elements a query finds, across the screens in navigator order, and which match comes
// next. An element is found by its text (its text regions' and its table cells' included), its name or its semantic label,
// ignoring case. Connectors have no box to highlight, so they are not searched. Pure over a read view.
import type { ReadView } from '@fluxion/core';
import { mastersInOrder, presentationOrder } from '@fluxion/render';
import type { RecordId, RichTextNode } from '@fluxion/schema';

/**
 * An element a search found, and the screen it is on.
 *
 * @public
 */
export type FindMatch = {
  /** The element. */
  readonly id: RecordId;
  /** Its screen. */
  readonly screen: RecordId;
};

/** The characters of a rich-text node, its children's run together. */
const textOf = (node: RichTextNode | undefined): string => (node === undefined ? '' : (node.text ?? '') + (node.content ?? []).map(textOf).join(' '));

/** What an element is found by: its texts, its name and its semantic label. */
type Searchable = {
  readonly kind?: string;
  readonly text?: RichTextNode;
  readonly texts?: { readonly [region: string]: RichTextNode };
  readonly cells?: { readonly [key: string]: { readonly text?: RichTextNode } };
  readonly name?: string;
  readonly semantic?: { readonly label?: string };
  readonly transform?: { readonly x: number; readonly y: number };
};

/** Every string an element is found by. */
export function searchableText(record: Searchable): readonly string[] {
  return [
    textOf(record.text),
    ...Object.values(record.texts ?? {}).map(textOf),
    ...Object.values(record.cells ?? {}).map((c) => textOf(c.text)),
    record.name ?? '',
    record.semantic?.label ?? '',
  ].filter((s) => s.trim() !== '');
}

/** The boxed elements of `screen` in reading order: top to bottom, then left to right. */
function elementsOf(view: ReadView, screen: RecordId): readonly { readonly id: RecordId; readonly record: Searchable }[] {
  return view
    .members('byScreen', screen)
    .map((id) => ({ id, record: view.get(id) as (Searchable & { readonly type?: string }) | undefined }))
    .flatMap((e) => (e.record?.type === 'element' && e.record.transform !== undefined ? [{ id: e.id, record: e.record }] : []))
    .sort((a, b) => (a.record.transform?.y ?? 0) - (b.record.transform?.y ?? 0) || (a.record.transform?.x ?? 0) - (b.record.transform?.x ?? 0));
}

/**
 * The elements `query` finds, screen by screen in navigator order (the screens in no section, then each section's; hidden
 * screens, then masters, included: they are edited too), each screen's in reading order; none for a blank query.
 *
 * @public
 */
export function findMatches(view: ReadView, query: string): readonly FindMatch[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return [];
  const screens = [...presentationOrder(view, true), ...mastersInOrder(view)];
  return screens.flatMap((screen) =>
    elementsOf(view, screen)
      .filter((e) => searchableText(e.record).some((s) => s.toLowerCase().includes(wanted)))
      .map((e) => ({ id: e.id, screen })),
  );
}

/**
 * The match `step` (1 next, -1 previous) from `current`, wrapping; from none (or one no longer found), the first match on
 * or after the shown screen going forward, the last before it going back.
 *
 * @public
 */
export function stepMatch(matches: readonly FindMatch[], current: RecordId | undefined, step: 1 | -1, shown?: RecordId): FindMatch | undefined {
  if (matches.length === 0) return undefined;
  const at = matches.findIndex((m) => m.id === current);
  if (at >= 0) return matches[(at + step + matches.length) % matches.length];
  const here = matches.findIndex((m) => m.screen === shown);
  if (here < 0) return step === 1 ? matches[0] : matches[matches.length - 1];
  return step === 1 ? matches[here] : matches[(here - 1 + matches.length) % matches.length];
}

/**
 * The ids `query` finds as one string, space-separated (on the screen `on` alone when given): a signal of it changes only when
 * the matches do, not with every edit to a record, so what draws them re-renders only then (docs/standards/performance.md).
 *
 * @public
 */
export function matchKey(view: ReadView, query: string, on?: RecordId): string {
  return findMatches(view, query)
    .flatMap((m) => (on === undefined || m.screen === on ? [m.id] : []))
    .join(' ');
}

/**
 * The ids of a {@link matchKey}.
 *
 * @public
 */
export const keyIds = (key: string): readonly RecordId[] => (key === '' ? [] : (key.split(' ') as RecordId[]));
