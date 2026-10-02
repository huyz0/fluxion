// Integrity hooks (ADR-0014 §Integrity hooks, FR-EXT-001): registered in the integrityHooks registry,
// run inside a transaction after its fn, sorted by key, to a fixed point. The built-ins keep a
// document referentially valid when records are deleted: owned records go with their owner, optional
// references are cleared. A deleted asset or theme that is still used is not cascaded (no hook can
// guess the replacement): validation refuses that transaction.
import type { AnyRecord, Diagnostic, Point, RecordId } from '@fluxion/schema';
import { groupBoundsHook } from './arrange/group-bounds.js';
import type { HookContext, IntegrityHook } from './hook-types.js';
import type { IndexName } from './indexes.js';
import { keysOf } from './indexes.js';
import type { Registry } from './registry.js';
import type { Tx } from './transaction.js';

export type { HookContext, IntegrityHook } from './hook-types.js';

type Fields = { readonly [key: string]: unknown };
const field = (record: AnyRecord | undefined, key: string): unknown => (record as Fields | undefined)?.[key];

const deletedOfType = ({ deleted }: HookContext, type: string): Array<[RecordId, AnyRecord]> => [...deleted].filter(([, r]) => r.type === type);

/** Deleting a screen deletes its elements and timelines (whose steps follow, see ownedHook). */
const screensHook: IntegrityHook = (context) => {
  const { tx, members } = context;
  for (const [screen] of deletedOfType(context, 'screen')) {
    for (const id of members('byScreen', screen)) tx.delete(id);
    for (const id of members('byType', 'timeline')) if (field(tx.get(id), 'screenId') === screen) tx.delete(id);
  }
};

/** Deleting an element deletes its whole subtree in one pass (children, their children, …). */
const subtreeHook: IntegrityHook = (context) => {
  const { tx, members } = context;
  const queue = deletedOfType(context, 'element').map(([id]) => id);
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of members('byParent', id)) {
      tx.delete(child);
      queue.push(child);
    }
  }
};

/** [type, field, action]: what happens to a record of `type` whose `field` names a deleted record. */
const OWNED: ReadonlyArray<readonly [string, string, 'delete' | 'clear']> = [
  ['step', 'timelineId', 'delete'],
  ['interaction', 'ownerId', 'delete'],
  ['comment', 'targetId', 'delete'],
  ['screen', 'masterId', 'clear'],
  ['screen', 'parentElementId', 'clear'],
];

/**
 * Records that belong to a deleted record go with it (a timeline's steps, an owner's interactions,
 * a target's comments); a screen's optional master or parent element is cleared (M3.14 review F1).
 */
/** Who points at what, as `OWNED` defines it: target id → [record, field, action]. */
function ownedPointers({ tx, members }: HookContext): Map<string, Array<readonly [RecordId, string, 'delete' | 'clear']>> {
  const pointers = new Map<string, Array<readonly [RecordId, string, 'delete' | 'clear']>>();
  for (const [type, key, action] of OWNED) {
    for (const id of members('byType', type)) {
      const target = field(tx.get(id), key);
      if (typeof target === 'string') pointers.set(target, [...(pointers.get(target) ?? []), [id, key, action]]);
    }
  }
  return pointers;
}

const ownedHook: IntegrityHook = (context) => {
  const { tx, deleted } = context;
  // a worklist, so a chain of owned records (a reply to a reply to a comment) goes in one pass
  const queue = [...deleted.keys()].filter((id) => !tx.get(id));
  // built when the first owner is reached (before any write here), so a pass that deletes nothing never scans
  let pointers: ReturnType<typeof ownedPointers> | undefined;
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    pointers ??= ownedPointers(context);
    // each owner is processed once, and every pointer was read from a live record, so no owned
    // record is gone yet when it is reached (a screen is only ever cleared, never deleted, here)
    for (const [owned, key, action] of pointers.get(id) ?? []) {
      if (action === 'clear') tx.patch(owned, { [key]: undefined });
      else {
        tx.delete(owned);
        queue.push(owned);
      }
    }
  }
};

/** The centre of an element's box, where a freed connector end is put. */
function centre(record: AnyRecord | undefined): Point {
  const t = field(record, 'transform') as { x?: number; y?: number; w?: number; h?: number } | undefined;
  return { x: (t?.x ?? 0) + (t?.w ?? 0) / 2, y: (t?.y ?? 0) + (t?.h ?? 0) / 2 };
}

/**
 * Bindings follow their ends: deleting a connector deletes its bindings; deleting a bound element
 * deletes the binding and frees that connector end at the element's centre; deleting a binding
 * directly frees its end unless another binding holds it.
 */
const bindingsHook: IntegrityHook = (context) => {
  const { tx, members, deleted } = context;
  for (const [element, before] of deletedOfType(context, 'element')) {
    for (const id of members('bindingsByElement', element)) {
      const binding = tx.get(id);
      if (!binding) continue;
      tx.delete(id);
      // tzap disable next-line ConditionalExpression,EqualityOperator,StringLiteral: freeing here is early only; the next pass frees the end from the deleted binding at the same centre (deleted.get(element)), and a deleted connector has no end to free
      if (field(binding, 'connectorId') !== element) freeEnd(tx, members, binding, centre(before));
    }
  }
  for (const [, binding] of deletedOfType(context, 'binding')) {
    const element = field(binding, 'elementId') as RecordId;
    freeEnd(tx, members, binding, centre(tx.get(element) ?? deleted.get(element)));
  }
};

/** Give the connector end `binding` held a free point, unless the end is still held or already free. */
function freeEnd(tx: Tx, members: HookContext['members'], binding: AnyRecord, at: Point): void {
  const connectorId = field(binding, 'connectorId') as RecordId;
  const connector = tx.get(connectorId);
  if (!connector) return;
  const end = field(binding, 'end');
  const free = end === 'target' ? 'freeTarget' : 'freeSource';
  if (field(connector, free) !== undefined) return;
  const held = members('bindingsByElement', connectorId).some((id) => {
    // a deleted binding reads as undefined, whose fields match no connector
    const other = tx.get(id);
    return field(other, 'connectorId') === connectorId && field(other, 'end') === end;
  });
  if (!held) tx.patch(connectorId, { [free]: at });
}

/**
 * The built-in hooks (FR-EXT-001), keyed so they run in this order: cascades that delete first,
 * bindings last.
 *
 * @public
 */
export const CORE_HOOKS: ReadonlyArray<readonly [string, IntegrityHook]> = [
  ['core:1-screens', screensHook],
  ['core:2-subtrees', subtreeHook],
  ['core:3-owned', ownedHook],
  ['core:4-bindings', bindingsHook],
  // after the cascades: a group is the bounds of the members that remain (M8.5)
  ['core:5-group-bounds', groupBoundsHook],
];

/**
 * Register the built-in hooks in `registry` as source `core`; returns the refused registrations (a
 * plugin already holding a key), so a missing built-in is never silent (M3.14 review F1).
 *
 * @public
 */
export function registerCoreHooks(registry: Registry<string, IntegrityHook>): Diagnostic[] {
  return CORE_HOOKS.flatMap(([key, hook]) => {
    const r = registry.register(key, hook, 'core');
    return r.ok ? [] : [r.error];
  });
}

/**
 * Index lookups as `tx` sees them: committed members that are still filed under the key, plus
 * pending records filed there. The pending records are indexed once per call (per hook pass), so a
 * lookup costs its result size, not the transaction's size (M3.14 review F3); records a hook adds
 * during a pass are seen by the next pass.
 */
export function pendingMembers(
  committed: (index: IndexName, key: string) => RecordId[],
  changes: ReadonlyMap<RecordId, AnyRecord | null>,
  tx: Tx,
): HookContext['members'] {
  const pending = new Map<string, RecordId[]>();
  for (const [id, record] of changes) {
    if (!record) continue;
    for (const [n, k] of keysOf(record)) {
      const key = `${n} ${k}`;
      const list = pending.get(key);
      if (list) list.push(id);
      else pending.set(key, [id]);
    }
  }
  const filed = (id: RecordId, index: IndexName, key: string) => {
    const record = tx.get(id);
    return record !== undefined && keysOf(record).some(([n, k]) => n === index && k === key);
  };
  return (index, key) => {
    // tzap disable next-line BooleanLiteral: an unchanged committed member is always still filed, so `changes.has(id) || filed` keeps the same ids
    const out = new Set(committed(index, key).filter((id) => !changes.has(id) || filed(id, index, key)));
    for (const id of pending.get(`${index} ${key}`) ?? []) if (filed(id, index, key)) out.add(id);
    return [...out];
  };
}
