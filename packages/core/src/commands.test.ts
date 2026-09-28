import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type AnyCommand, type CommandTxOptions, defineCommand, executeCommand } from './commands.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

function setup() {
  const b = documentBuilder({ seed: 30 });
  const a = b.rect(b.screen());
  const store = new RecordStore(b.build());
  const commands = createRegistry<string, AnyCommand>('commands');
  let enabled = true;
  const rename = defineCommand({
    id: 'element.rename',
    title: { id: 'command.element.rename', defaultMessage: 'Rename' },
    args: z.object({ id: z.string().min(1), name: z.string().min(1).max(40) }),
    when: () => enabled,
    run: (ctx, args) => ctx.store.transact('rename', (tx) => tx.patch(args.id as RecordId, { name: args.name }), ctx.options),
  });
  commands.register(rename.id, rename, 'core');
  return { store, commands, ctx: { store }, a, disable: () => (enabled = false) };
}

describe('commands (03-core-engine §2, ADR-0014)', () => {
  it('FR-EDT-006: IF args fail the schema THEN THE SYSTEM SHALL return diagnostics and leave the store unchanged', () => {
    const { store, commands, ctx, a } = setup();
    const before = store.toDocument();
    const r = executeCommand(commands, ctx, 'element.rename', { id: a, name: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('COMMAND_ARGS');
    expect(r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', severity: 'error', path: '/args/name' })]);
    // every issue is reported, not only the first
    const both = executeCommand(commands, ctx, 'element.rename', { name: 42 });
    expect(!both.ok && both.error.diagnostics.map((d) => d.path).sort()).toEqual(['/args/id', '/args/name']);
    expect(store.toDocument()).toEqual(before);
  });

  it('FR-EXT-001: a command whose when is false is refused with a diagnostic', () => {
    const { store, commands, ctx, a, disable } = setup();
    disable();
    const r = executeCommand(commands, ctx, 'element.rename', { id: a, name: 'x' });
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_DISABLED', path: '/commands/element.rename' })]);
    expect((store.get(a) as { name?: string }).name).toBeUndefined();
  });

  it('an unknown command id is a diagnostic', () => {
    const { commands, ctx } = setup();
    const r = executeCommand(commands, ctx, 'nope', {});
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_UNKNOWN', path: '/commands/nope' })]);
  });

  it('valid args run the command; its result is the transaction result', () => {
    const { store, commands, ctx, a } = setup();
    expect(executeCommand(commands, ctx, 'element.rename', { id: a, name: 'API' }).ok).toBe(true);
    expect((store.get(a) as AnyRecord & { name?: string }).name).toBe('API');
    // a transaction failure comes back as the command's failure, store unchanged
    const breaking = defineCommand({
      id: 'element.break',
      title: { id: 'command.element.break', defaultMessage: 'Break' },
      args: z.object({ id: z.string() }),
      run: (c, args) => c.store.transact('break', (tx) => tx.patch(args.id as RecordId, { transform: 'nope' })),
    });
    commands.register(breaking.id, breaking, 'core');
    const r = executeCommand(commands, ctx, 'element.break', { id: a });
    expect(!r.ok && r.error.code).toBe('TX_INVALID');
    expect((store.get(a) as { transform: unknown }).transform).not.toBe('nope');
  });

  it('NFR-MNT-006: a command cannot run with an undo or redo origin', () => {
    const { store, commands, a } = setup();
    const before = store.toDocument();
    for (const origin of ['undo', 'redo']) {
      // typed callers cannot pass it; untyped callers are refused at run time
      // @ts-expect-error CommandTxOptions excludes the history origins
      const typed: CommandTxOptions = { origin };
      expect(typed.origin).toBe(origin);
      const ctx = { store, options: { origin } } as unknown as Parameters<typeof executeCommand>[1];
      const r = executeCommand(commands, ctx, 'element.rename', { id: a, name: 'x' });
      expect(!r.ok && r.error.code).toBe('COMMAND_ARGS');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: '/options/origin' })]);
    }
    expect(store.toDocument()).toEqual(before);
    expect(store.history.undoDepth).toBe(0);
    // the other origins run, and system writes are recorded
    expect(executeCommand(commands, { store, options: { origin: 'system' } }, 'element.rename', { id: a, name: 'sys' }).ok).toBe(true);
    expect(executeCommand(commands, { store, options: { origin: 'remote' } }, 'element.rename', { id: a, name: 'rem' }).ok).toBe(true);
    expect(store.history.undoDepth).toBe(1);
    // nor can a command's own run write with one: the store refuses it (M4.4 review F3)
    const forged = defineCommand({
      id: 'element.forge',
      title: { id: 'command.element.forge', defaultMessage: 'Forge' },
      args: z.object({ id: z.string() }),
      run: (c, args) => c.store.transact('forge', (tx) => tx.patch(args.id as RecordId, { name: 'forged' }), { origin: 'undo' }),
    });
    commands.register(forged.id, forged, 'acme');
    const f = executeCommand(commands, { store }, 'element.forge', { id: a });
    expect(!f.ok && f.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_ORIGIN_RESERVED', severity: 'error' })]);
    expect((store.get(a) as { name?: string }).name).toBe('rem');
    // nor through a batch, whose transaction is the store's checked one (M4.4 review round 2)
    const viaBatch = store.history.batch('forge', () => store.transact('x', (tx) => tx.patch(a, { name: 'forged' })), { origin: 'undo' });
    expect(!viaBatch.ok && viaBatch.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_ORIGIN_RESERVED' })]);
    expect((store.get(a) as { name?: string }).name).toBe('rem');
    // undo itself still replays through the history module
    expect(store.history.undo().ok).toBe(true);
  });
});
