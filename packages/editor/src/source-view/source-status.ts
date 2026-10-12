// The status line of the source view (FR-EDT-022): what the last try came to, in words. Pure of CodeMirror and React.
import { t } from '@lingui/core/macro';
import '../i18n.js';
import type { MergeConflict } from './merge.js';
import type { SyncResult } from './source-apply.js';

/** What a field of a conflict is called to the author: the whole path, else its first part. */
const FIELD_NAMES: { readonly [field: string]: () => string } = {
  '*': () => t`deleted on the canvas`,
  placement: () => t`position`,
  transform: () => t`position and size`,
  'transform.x': () => t`position`,
  'transform.y': () => t`position`,
  'transform.w': () => t`size`,
  'transform.h': () => t`size`,
  text: () => t`text`,
  'semantic.label': () => t`label`,
  'semantic.slug': () => t`name`,
  semantic: () => t`details`,
  meta: () => t`settings`,
  params: () => t`settings`,
  style: () => t`style`,
  tone: () => t`tone`,
  parentId: () => t`group`,
};

const fieldName = (path: string): string => (FIELD_NAMES[path] ?? FIELD_NAMES[path.split('.')[0] ?? ''])?.() ?? path;

/** "Overwrote canvas changes to: api (position), db (label)": the records the text overwrote, with what of them. */
function conflictText(conflicts: readonly MergeConflict[]): string {
  const list = conflicts.map((c) => `${c.label} (${[...new Set(c.fields.map(fieldName))].join(', ')})`).join(', ');
  return t`Overwrote canvas changes to: ${list}.`;
}

/** What a deleted element took with it: the records outside the view that pointed at it. */
const dependentText = (n: number): string =>
  n === 1 ? t`Removed or cleaned 1 record that pointed at a deleted element.` : t`Removed or cleaned ${n} records that pointed at a deleted element.`;

/** The nodes and connectors the merge could not tell the rename of. */
const unpairedText = (slugs: readonly string[]): string =>
  t`Could not tell which node or connector was renamed: ${slugs.join(', ')}. Their comments and canvas changes were removed.`;

/** What an apply did beyond the change: conflicts, records cleaned, nodes and connectors it could not pair. */
function appliedNotes(result: SyncResult): string[] {
  return [
    ...(result.conflicts !== undefined && result.conflicts.length > 0 ? [conflictText(result.conflicts)] : []),
    ...(result.dependents !== undefined && result.dependents > 0 ? [dependentText(result.dependents)] : []),
    ...(result.unpaired !== undefined && result.unpaired.length > 0 ? [unpairedText(result.unpaired)] : []),
  ];
}

/** A short line of what the last try came to. */
export function statusText(result: SyncResult | undefined, errors: number): string {
  if (result === undefined) return '';
  if (result.status === 'invalid')
    return errors === 1 ? t`1 error: the canvas keeps its last good state.` : t`${errors} errors: the canvas keeps its last good state.`;
  if (result.status === 'refused') return t`The document refused the change: ${result.problem ?? ''}`;
  if (result.status === 'unchanged') return t`Up to date.`;
  if (result.status === 'gone') return t`The screen was deleted on the canvas: the text was not applied.`;
  return [t`Applied to the canvas.`, ...appliedNotes(result)].join(' ');
}
