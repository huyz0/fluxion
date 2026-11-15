// A shape's region and slot problems (FR-SHP-007, ADR-0054, M19 cp2 F2): a `texts` entry naming the first text region, which the
// element's `text` draws instead, and an icon slot naming a definition that is not available (M19.17 r1 F2). Neither is drawn; the
// Problems tab reports each with a fix that removes the entry.
import type { ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import type { Problem } from './problem-types.js';

/**
 * Where shape definitions are looked up.
 *
 * @public
 */
export type ShapeDefLookup = {
  /** The definition `id`, if registered. */
  get(id: string): ShapeDef | undefined;
};

type Shaped = {
  readonly id: string;
  readonly type: string;
  readonly kind?: unknown;
  readonly defId?: unknown;
  readonly texts?: { readonly [region: string]: unknown };
  readonly icons?: { readonly [slot: string]: { readonly defId?: unknown } };
};

/** `entries` without `key`, or undefined when nothing is left (the field goes with its last entry). */
function without<T>(entries: { readonly [key: string]: T }, key: string): { readonly [key: string]: T } | undefined {
  const { [key]: _, ...rest } = entries;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** The problem of a `texts` entry of shape `r` (of definition `defId`) naming the first region, if it has one. */
function firstRegionText(r: Shaped, defId: string, shapeDefs: ShapeDefLookup): Problem[] {
  const first = shapeDefs.get(defId)?.textRegions?.[0]?.name;
  if (r.texts === undefined || first === undefined || !Object.hasOwn(r.texts, first)) return [];
  return [
    {
      id: `FLX_TEXT_FIRST_REGION|${r.id}`,
      severity: 'warning',
      message: `The text kept for region "${first}" is not drawn: that region shows the shape's own text.`,
      elements: [r.id as RecordId],
      fix: { title: 'Remove the hidden text', command: 'element.update', args: { id: r.id, fields: { texts: without(r.texts, first) } } },
    },
  ];
}

/** One problem for each icon slot of shape `r` filled with a definition `shapeDefs` does not hold: the slot draws nothing. */
function missingIcons(r: Shaped, shapeDefs: ShapeDefLookup): Problem[] {
  const icons = r.icons ?? {};
  return Object.keys(icons)
    .sort()
    .flatMap((slot): Problem[] => {
      const defId = icons[slot]?.defId;
      if (typeof defId !== 'string' || shapeDefs.get(defId) !== undefined) return [];
      return [
        {
          id: `FLX_ICON_UNKNOWN|${r.id}|${slot}`,
          severity: 'warning',
          message: `The icon slot "${slot}" names the shape ${defId}, which is not available: the slot draws nothing.`,
          elements: [r.id as RecordId],
          fix: { title: 'Empty the icon slot', command: 'element.update', args: { id: r.id, fields: { icons: without(icons, slot) } } },
        },
      ];
    });
}

/**
 * The region and slot problems of every shape in `doc`: a `texts` entry naming its definition's first text region, and an icon
 * slot naming a definition `shapeDefs` does not hold; each fix drops that entry (and the field with its last entry).
 *
 * @public
 */
export function regionProblems(doc: DocumentFile, shapeDefs: ShapeDefLookup): Problem[] {
  return (Object.values(doc.records) as Shaped[]).flatMap((r) => {
    if (r.type !== 'element' || r.kind !== 'shape' || typeof r.defId !== 'string') return [];
    return [...firstRegionText(r, r.defId, shapeDefs), ...missingIcons(r, shapeDefs)];
  });
}
