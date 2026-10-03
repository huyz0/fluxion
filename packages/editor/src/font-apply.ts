// Applying a font to the selection (FR-THM-008, M9.17): the family goes into `style.font.family` of each selected element, in one
// `element.updateMany` (one undo step). The rest of the element's style, and of its font style, stays as it is.
import type { ReadView } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { Execute } from './pointer.js';

type Rec = { readonly [field: string]: unknown };
const object = (v: unknown): Rec => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {});

/**
 * Set the font family of the elements `ids` to `family`: true when something was set. Ids that are not elements are left alone.
 *
 * @public
 */
export function applyFontFamily(view: ReadView, execute: Execute, ids: readonly RecordId[], family: string): boolean {
  const updates = ids.flatMap((id) => {
    const element = view.get(id) as Rec | undefined;
    if (element?.['type'] !== 'element') return [];
    const style = object(element['style']);
    return [{ id, fields: { style: { ...style, font: { ...object(style['font']), family } } } }];
  });
  return updates.length > 0 && execute('element.updateMany', { updates }).ok;
}

/**
 * The families of the font assets the document holds, in the order of their records, once each.
 *
 * @public
 */
export function documentFontFamilies(view: ReadView): readonly string[] {
  const families = view.members('byType', 'asset').flatMap((id) => {
    const family = object(object(view.get(id))['font'])['family'];
    return typeof family === 'string' ? [family] : [];
  });
  return [...new Set(families)];
}
