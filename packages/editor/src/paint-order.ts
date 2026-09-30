// What the hit index keeps in step with the store (FR-EDT-004): which elements a change may have
// moved, and the order elements are painted in, as render orders them (fractional index, the id
// breaking a tie), members above their parent.
import type { Store } from '@fluxion/core';
import { compareKeys, type RecordId } from '@fluxion/schema';

/** The elements a change of the records `ids` may have moved: them, their members, and connectors bound to them. */
export function affected(store: Store, ids: Iterable<RecordId>): Set<RecordId> {
  const out = new Set<RecordId>();
  const visit = (id: RecordId) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of store.members('byParent', id)) visit(child);
    for (const b of store.members('bindingsByElement', id)) {
      const binding = store.get(b) as { connectorId?: RecordId } | undefined;
      if (binding?.connectorId !== undefined) visit(binding.connectorId);
    }
  };
  for (const id of ids) {
    const r = store.get(id);
    // a changed binding moves its connector (deleting one re-places the connector in the same
    // transaction, core's integrity hooks, so the connector is in the diff itself)
    // tzap disable next-line ConditionalExpression, StringLiteral: core's hooks re-put a connector whose binding changes too; this does not rely on them
    visit(r?.type === 'binding' ? (r as { connectorId: RecordId }).connectorId : id);
  }
  return out;
}

/** Paint order of every drawn element: screen by screen, back to front, members above their parent. */
export function paintOrder(store: Store): Map<RecordId, number> {
  const rank = new Map<RecordId, number>();
  // tzap disable next-line StringLiteral: an element always has an index
  const indexOf = (id: RecordId) => String((store.get(id) as { index?: unknown }).index ?? '');
  // as render orders them: by fractional index, the id breaking a tie (a duplicate index is only a warning)
  // tzap disable next-line EqualityOperator: two ids are never equal
  const byIndex = (a: RecordId, b: RecordId) => compareKeys(indexOf(a), indexOf(b)) || (a < b ? -1 : 1);
  const walk = (ids: readonly RecordId[]) => {
    for (const id of [...ids].sort(byIndex)) {
      rank.set(id, rank.size);
      walk(store.members('byParent', id));
    }
  };
  for (const screen of store.members('byType', 'screen') as RecordId[]) {
    walk(store.members('byScreen', screen).filter((id) => (store.get(id) as { parentId?: unknown }).parentId === undefined));
  }
  return rank;
}
