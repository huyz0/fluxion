import { CORE_SHAPE_IDS } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';

/** The definition id an icon-slot fill names, if any (an image fill names none). */
function fillDefId(fill: unknown): string | undefined {
  if (typeof fill !== 'object' || fill === null) return undefined;
  const id = (fill as { readonly defId?: unknown }).defId;
  return typeof id === 'string' ? id : undefined;
}

/** The icon-slot fills of a shape record; none for any other record. */
function slotFills(record: DocumentFile['records'][string]): unknown[] {
  if (record.type !== 'element' || record['kind'] !== 'shape') return [];
  const icons = record['icons'];
  return typeof icons === 'object' && icons !== null ? Object.values(icons) : [];
}

/** The pack definition ids the document's icon slots name, builtin and core shapes left out (FR-SHP-007, M19.38). */
export function slotIds(document: Pick<DocumentFile, 'records'>, builtinIds: ReadonlySet<string>): Set<string> {
  const ids = Object.values(document.records)
    .flatMap(slotFills)
    .map(fillDefId)
    .filter((id): id is string => id !== undefined && !builtinIds.has(id) && !CORE_SHAPE_IDS.has(id));
  return new Set(ids);
}

/** Marks used the held definitions an icon slot names, so a slot-only reference is embedded; an id no source holds refuses nothing. */
export function addSlotDefinitions<Id extends string>(
  document: Pick<DocumentFile, 'records'>,
  builtinIds: ReadonlySet<string>,
  held: Iterable<{ readonly id: Id }>,
  used: Set<Id>,
): void {
  const slots = slotIds(document, builtinIds);
  for (const def of held) if (slots.has(def.id)) used.add(def.id);
}
