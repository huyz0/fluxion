// The AI panel's preview (FR-EDT-014, ADR-0035): a patch is run on `store.fork()`, so the person sees what it would do before the real store is
// touched. The change list and the ghost boxes come from comparing the fork with the store; Apply then runs `ai.applyPatch` on the real store.
import type { CoreRegistries, Store } from '@fluxion/core';
import { applyPatchCommand } from '@fluxion/dsl';
import type { Diagnostic, RecordId } from '@fluxion/schema';
import { labelOf, type Named } from './record-label.js';

/** One line of the change list. */
export type Change = { readonly kind: 'added' | 'changed' | 'removed'; readonly id: string; readonly label: string };

/** A box on the preview, in screen units. */
export type GhostBox = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly state: 'added' | 'changed' | 'kept';
};

/** What a patch would do. */
export type Preview =
  | { readonly ok: true; readonly changes: readonly Change[]; readonly screen: { readonly w: number; readonly h: number }; readonly boxes: readonly GhostBox[] }
  | { readonly ok: false; readonly problems: readonly string[] };

type Rec = Named & {
  readonly id: string;
  readonly screenId?: string;
  readonly transform?: { x: number; y: number; w: number; h: number };
  readonly size?: { w: number; h: number };
};

const recordOf = (store: Store, id: string): Rec | undefined => store.get(id as RecordId) as Rec | undefined;

const problemsOf = (diagnostics: readonly Diagnostic[]): string[] =>
  diagnostics.length > 0 ? diagnostics.map((d) => d.message) : ['the patch does not apply'];

/** The change list of `fork` against `store`: elements and edges that were added, changed or removed (layout moves count as changes). */
function changesOf(store: Store, fork: Store): Change[] {
  const out: Change[] = [];
  const shown = (r: Rec | undefined): r is Rec => r !== undefined && (r.type === 'element' || r.type === 'edge' || r.type === 'screen');
  for (const id of fork.ids()) {
    const after = recordOf(fork, id);
    const before = recordOf(store, id);
    if (!shown(after)) continue;
    if (before === undefined) out.push({ kind: 'added', id, label: labelOf(after) });
    else if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ kind: 'changed', id, label: labelOf(after) });
  }
  for (const id of store.ids()) {
    const before = recordOf(store, id);
    if (shown(before) && !fork.has(id as RecordId)) out.push({ kind: 'removed', id, label: labelOf(before) });
  }
  return out;
}

/** The boxes of a screen's elements in `fork`, marked by what the patch did to them. */
function boxesOf(store: Store, fork: Store, screenId: string, changes: readonly Change[]): GhostBox[] {
  const state = new Map(changes.map((c) => [c.id, c.kind]));
  const boxes: GhostBox[] = [];
  for (const id of fork.members('byScreen', screenId as RecordId)) {
    const r = recordOf(fork, id);
    if (r?.type !== 'element' || r.transform === undefined) continue;
    const s = state.get(id);
    boxes.push({ id, ...r.transform, state: s === 'added' ? 'added' : s === 'changed' ? 'changed' : 'kept' });
  }
  return boxes.filter((b) => store.has(b.id as RecordId) || b.state === 'added');
}

/**
 * Run `patch` on a fork of `store` and report what it would do on `screenId`; the store itself is not touched.
 *
 * @param store - the open document's store
 * @param registries - the document's registries
 * @param patch - the AI patch
 * @param screenId - the screen the ghost boxes show
 */
export function previewPatch(store: Store, registries: CoreRegistries, patch: unknown, screenId: string | undefined): Preview {
  const fork = store.fork();
  const run = applyPatchCommand(registries).run({ store: fork }, { patch });
  if (!run.ok) return { ok: false, problems: problemsOf(run.error.diagnostics ?? []) };
  const changes = changesOf(store, fork);
  const screen = (screenId === undefined ? undefined : recordOf(fork, screenId)) ?? recordOf(fork, fork.members('byType', 'screen')[0] ?? '');
  const size = screen?.size ?? { w: 1920, h: 1080 };
  return { ok: true, changes, screen: size, boxes: screen === undefined ? [] : boxesOf(store, fork, screen.id, changes) };
}
