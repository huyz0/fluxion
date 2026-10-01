// The inspector fields of an element kind (FR-EDT-008, ADR-0149): what its schema marks editable.
import { describeFields, type FieldDef } from './field-meta.js';
import { elementKindSchemas } from './records/element-schemas.js';

const cache = new Map<string, readonly FieldDef[]>();

/**
 * The editable fields of the element kind `kind`, from its schema's `.meta`: a core kind's own, a plugin
 * kind's (a qualified name) the plugin element's, and a kind this version does not know none.
 *
 * @public
 */
export function elementFields(kind: string): readonly FieldDef[] {
  const known = Object.hasOwn(elementKindSchemas, kind) && kind !== 'plugin' && kind !== 'unknown';
  const key = known ? kind : kind.includes(':') ? 'plugin' : 'unknown';
  let fields = cache.get(key);
  if (fields === undefined) {
    fields = describeFields(elementKindSchemas[key as keyof typeof elementKindSchemas]);
    cache.set(key, fields);
  }
  return fields;
}
