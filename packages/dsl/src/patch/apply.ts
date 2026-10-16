// The `ai.applyPatch` command (ADR-0035, FR-AI-003): resolve the patch against the store, lower it, apply it to a fork of the store (so the
// transaction's validation and the integrity hooks run, and the touched containers are laid out incrementally by the synchronous layout
// pipeline, ADR-0033), then write the fork's net change in ONE transaction of the real store. The revision is read and compared inside that
// transaction, before anything is read, so no edit can slip in between the check and the write. Any failure leaves the store as it was.
import {
  type AnyCommand,
  type CommandContext,
  type CoreRegistries,
  type Diff,
  defineCommand,
  type Registry,
  resolveSalt,
  type Store,
  sha256Hash128,
  type TxFailure,
} from '@fluxion/core';
import { arrangeCommand, type LayoutAlgorithm } from '@fluxion/layout';
import { type AnyRecord, type Diagnostic, err, ok, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { lowerPatch, type Relayout } from './lower.js';
import { resolvePatch } from './resolve.js';

/**
 * The id of the apply-patch command.
 *
 * @public
 */
export const APPLY_PATCH_COMMAND_ID = 'ai.applyPatch';

/**
 * What a successful `ai.applyPatch` reports.
 *
 * @public
 */
export type AppliedPatch = {
  /** How many ops the patch had. */
  readonly ops: number;
  /** How many records the patch put or deleted, layout moves included. */
  readonly changed: number;
  /** The document revision after the patch, as `r<N>`. */
  readonly revision: string;
};

const failure = (message: string, diagnostics: readonly Diagnostic[]): TxFailure => ({
  code: 'COMMAND_ARGS',
  message: `${APPLY_PATCH_COMMAND_ID}: ${message}`,
  diagnostics,
});

/** The document revision as ADR-0035 prints it. */
const revisionOf = (store: Store): string => `r${store.revision}`;

/** The records of a store, keyed by id. */
function recordsOf(store: Store): { [id: string]: AnyRecord } {
  return Object.fromEntries(store.ids().map((id) => [id, store.get(id) as AnyRecord]));
}

/** The layout run on the fork for one touched container; `undefined` when there is nothing to lay out, else the failure. */
function arrange(fork: Store, registries: CoreRegistries, at: Relayout): TxFailure | undefined {
  const container = at.containerId;
  const owner = fork.get((container ?? at.screenId) as RecordId) as (AnyRecord & { layout?: { type?: string; options?: unknown } }) | undefined;
  if (!owner || fork.members('byScreen', at.screenId).length === 0) return undefined;
  const lookup = (name: string) => registries.layouts.get(name) as LayoutAlgorithm<never> | undefined;
  const type = owner.layout?.type;
  const own = type !== undefined && lookup(type) !== undefined;
  const run = arrangeCommand(lookup).run(
    { store: fork },
    {
      screenId: at.screenId,
      scope: container ? { containerId: container } : 'screen',
      algorithm: own ? type : 'layered',
      ...(own && !container ? { options: owner.layout?.options } : {}),
    },
  );
  return run.ok ? undefined : run.error;
}

/** The lowered records written to the scratch fork, through a command like every other write (NFR-MNT-006). */
const writeFork = defineCommand({
  id: 'ai.applyPatch.fork',
  title: { id: 'command.ai.applyPatch', defaultMessage: 'Apply AI patch' },
  args: z.object({ puts: z.array(z.custom<AnyRecord>()), deletes: z.array(z.string()) }),
  run: (ctx: CommandContext, args) =>
    ctx.store.transact('ai.applyPatch', (tx) => {
      for (const record of args.puts) tx.put(record);
      for (const id of args.deletes) tx.delete(id as RecordId);
    }),
});

/** The net change of the patch as a diff of the real store, or why it cannot apply. */
function plan(store: Store, registries: CoreRegistries, patch: unknown): Result<Diff, TxFailure> {
  const records = recordsOf(store);
  const resolved = resolvePatch(patch, { records, revision: revisionOf(store), registries });
  if (!resolved.ok) return err(failure(`${resolved.diagnostics.length} problem(s) in the patch`, resolved.diagnostics));
  const document = records[store.members('byType', 'document')[0] ?? ''] as { source?: { salt?: unknown } } | undefined;
  const lowered = lowerPatch(resolved.value, { records, salt: resolveSalt(document, ''), hasher: sha256Hash128, registries });
  const fork = store.fork();
  const written = writeFork.run({ store: fork }, { puts: [...lowered.puts], deletes: [...lowered.deletes] });
  if (!written.ok) return err(failure('the patch does not make a valid document', written.error.diagnostics));
  for (const at of lowered.relayout) {
    const bad = arrange(fork, registries, at);
    if (bad) return err(failure(`layout failed: ${bad.message}`, bad.diagnostics));
  }
  return ok(fork.diffFrom(store) as Diff);
}

/**
 * The `ai.applyPatch` command for a host's registries: argument `patch` (the plain or the strict form, ADR-0035). One transaction, one
 * undo entry; the stale check and the write share it. Invalid patches are rejected whole with `FLX_PATCH_*` diagnostics.
 *
 * @public
 */
export function applyPatchCommand(registries: CoreRegistries): AnyCommand {
  return defineCommand({
    id: APPLY_PATCH_COMMAND_ID,
    title: { id: 'command.ai.applyPatch', defaultMessage: 'Apply AI patch' },
    args: z.object({ patch: z.unknown() }),
    run: (ctx: CommandContext, args) => {
      let refused: TxFailure | undefined;
      let ops = 0;
      let changed = 0;
      const done = ctx.store.transact(
        APPLY_PATCH_COMMAND_ID,
        (tx) => {
          const planned = plan(ctx.store, registries, args.patch);
          if (!planned.ok) {
            refused = planned.error;
            return;
          }
          ops = Array.isArray((args.patch as { ops?: unknown[] }).ops) ? (args.patch as { ops: unknown[] }).ops.length : 0;
          changed = planned.value.puts.size + planned.value.deletes.size;
          for (const { after } of planned.value.puts.values()) tx.put(after);
          for (const id of planned.value.deletes.keys()) tx.delete(id);
        },
        ctx.options,
      );
      if (refused) return err(refused);
      return done.ok ? ok({ ops, changed, revision: revisionOf(ctx.store) } satisfies AppliedPatch) : done;
    },
  });
}

/**
 * Register `ai.applyPatch` in a host's `commands` registry as source `core`.
 *
 * @public
 */
export function registerApplyPatchCommand(
  commands: Registry<string, AnyCommand>,
  registries: CoreRegistries,
): ReturnType<Registry<string, AnyCommand>['register']> {
  return commands.register(APPLY_PATCH_COMMAND_ID, applyPatchCommand(registries), 'core');
}
