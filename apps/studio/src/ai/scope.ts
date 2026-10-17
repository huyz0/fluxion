// What the AI panel tells the model about the document (FR-EDT-014): the screens and elements in scope, each with the reference a patch uses.
import type { Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { labelOf, type Named } from './record-label.js';

/** What the request covers. */
export type Scope = 'document' | 'screen' | 'selection';

type Rec = Named & { readonly id: string; readonly screenId?: string };

const recOf = (store: Store, id: string): Rec | undefined => store.get(id as RecordId) as Rec | undefined;

function lineOf(r: Rec): string {
  return `- #${r.id} ${r.type === 'screen' ? 'screen' : (r.kind ?? r.type)} ${JSON.stringify(labelOf(r))}${r.screenId ? ` (screen #${r.screenId})` : ''}`;
}

/** The records in `scope`, one line each, with the revision a patch may name as its base. */
export function scopeText(store: Store, scope: Scope, screen: string | undefined, selection: readonly string[]): string {
  const screens = store.members('byType', 'screen') as readonly string[];
  const active = screen !== undefined && screens.includes(screen) ? screen : screens[0];
  const ids =
    scope === 'selection'
      ? [...selection]
      : (scope === 'screen' ? (active === undefined ? [] : [active]) : [...screens]).flatMap((s) => [s, ...store.members('byScreen', s as RecordId)]);
  const lines = ids
    .map((id) => recOf(store, id))
    .filter((r): r is Rec => r !== undefined)
    .map(lineOf);
  return `revision r${store.revision}; ${scope}:\n${lines.join('\n')}`;
}
