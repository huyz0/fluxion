import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';
import type { Diff } from './transaction.js';

function setup() {
  const b = documentBuilder({ seed: 40 });
  const s1 = b.screen();
  const s2 = b.screen();
  const s3 = b.screen();
  const a = b.rect(s1);
  const c = b.rect(s1, { x: 300 });
  const line = b.connect(a, c);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  expect(registerCoreCommands(commands)).toEqual([]);
  const diffs: Diff[] = [];
  store.subscribe((d) => diffs.push(d));
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  return { store, run, diffs, s1, s2, s3, a, c, line };
}

describe('built-in record commands: assets and connector ends (FR-EXT-001)', () => {
  it('FR-EXT-001: asset.create adds an asset record in one write, refuses an id that is taken, and is undone in one step', () => {
    const { store, run, diffs, a } = setup();
    const asset = { id: 'AssetAssetAsset01', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 3, name: 'a.png' };
    expect(run('asset.create', { asset }).ok).toBe(true);
    expect(store.get('AssetAssetAsset01' as RecordId)).toEqual(asset);
    expect(diffs.at(-1)?.puts.size).toBe(1);
    expect(diffs.at(-1)?.deletes.size).toBe(0);
    // the id is taken (by the asset, or by any record): refused, nothing written
    const before = diffs.length;
    expect(run('asset.create', { asset }).ok).toBe(false);
    expect(run('asset.create', { asset: { ...asset, id: a } }).ok).toBe(false);
    expect(diffs.length).toBe(before);
    // not an asset record
    expect(run('asset.create', { asset: { ...asset, type: 'element' } }).ok).toBe(false);
    expect(run('asset.create', {}).ok).toBe(false);
    store.history.undo();
    expect(store.get('AssetAssetAsset01' as RecordId)).toBeUndefined();
  });

  it('FR-AST-005: asset.update replaces what an asset record says, asset.delete removes it, in one undo step each, and neither touches another type', () => {
    const { store, run, diffs, a } = setup();
    const asset = { id: 'AssetAssetAsset01', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 3, name: 'a.png' };
    expect(run('asset.create', { asset }).ok).toBe(true);
    const replaced = run('asset.update', { id: asset.id, fields: { hash: 'b'.repeat(64), mime: 'image/webp', size: 9 } });
    expect(replaced.ok).toBe(true);
    expect(store.get(asset.id as RecordId)).toMatchObject({ hash: 'b'.repeat(64), mime: 'image/webp', size: 9, name: 'a.png' });
    store.history.undo();
    expect(store.get(asset.id as RecordId)).toMatchObject({ hash: 'a'.repeat(64), mime: 'image/png' });
    // an element id, a missing id and an identity field are refused with nothing written
    const before = diffs.length;
    expect(run('asset.update', { id: a, fields: { name: 'x' } }).ok).toBe(false);
    expect(run('asset.update', { id: 'missing', fields: {} }).ok).toBe(false);
    expect(run('asset.update', { id: asset.id, fields: { type: 'element' } }).ok).toBe(false);
    expect(run('asset.delete', { ids: [a] }).ok).toBe(false);
    expect(run('asset.delete', { ids: [asset.id, asset.id] }).ok).toBe(false);
    expect(run('asset.delete', { ids: [] }).ok).toBe(false);
    expect(diffs.length).toBe(before);
    expect(run('asset.delete', { ids: [asset.id] }).ok).toBe(true);
    expect(store.get(asset.id as RecordId)).toBeUndefined();
    store.history.undo();
    expect(store.get(asset.id as RecordId)).toBeDefined();
  });

  it('FR-AST-005: asset.delete of an asset an element still names is refused by the document check, and nothing changes', () => {
    const { store, run, s1 } = setup();
    const asset = { id: 'AssetAssetAsset02', type: 'asset', hash: 'c'.repeat(64), mime: 'image/png', size: 3, name: 'c.png' };
    expect(run('asset.create', { asset }).ok).toBe(true);
    const image = {
      id: 'ImageImageImage01',
      type: 'element',
      kind: 'image',
      screenId: s1,
      index: 'a5',
      assetId: asset.id,
      transform: { x: 0, y: 0, w: 10, h: 10 },
    };
    expect(run('element.create', { element: image }).ok).toBe(true);
    const refused = run('asset.delete', { ids: [asset.id] });
    expect(refused.ok).toBe(false);
    expect(store.get(asset.id as RecordId)).toBeDefined();
    expect(run('element.delete', { ids: [image.id] }).ok).toBe(true);
    expect(run('asset.delete', { ids: [asset.id] }).ok).toBe(true);
  });

  it('FR-EXT-001: connector.freeEnd lets go of a bound end, holding it at the point, in one undo step', () => {
    const { store, run, line } = setup();
    const connector = () => store.get(line) as { freeSource?: unknown; freeTarget?: unknown };
    const bound = store.members('byType', 'binding').filter((b) => (store.get(b) as { connectorId?: string }).connectorId === line);
    expect(bound.length).toBe(2);
    const free = run('connector.freeEnd', { connectorId: line, end: 'source', at: { x: 7, y: 9 } });
    expect(free.ok).toBe(true);
    expect(connector().freeSource).toEqual({ x: 7, y: 9 });
    expect(store.members('byType', 'binding')).toHaveLength(1);
    // the other end is still bound
    expect(connector().freeTarget).toBeUndefined();
    store.history.undo();
    expect(connector().freeSource).toBeUndefined();
    expect(store.members('byType', 'binding')).toHaveLength(2);
    // an end that is free already is only moved
    expect(run('connector.freeEnd', { connectorId: line, end: 'source', at: { x: 1, y: 2 } }).ok).toBe(true);
    expect(run('connector.freeEnd', { connectorId: line, end: 'source', at: { x: 3, y: 4 } }).ok).toBe(true);
    expect(connector().freeSource).toEqual({ x: 3, y: 4 });
    // refusals: a missing connector, a bad end, a bad point, no point
    for (const args of [
      { connectorId: 'MissingMissing01', end: 'source', at: { x: 0, y: 0 } },
      { connectorId: line, end: 'middle', at: { x: 0, y: 0 } },
      { connectorId: line, end: 'source', at: { x: Number.NaN, y: 0 } },
      { connectorId: line, end: 'source' },
    ])
      expect(run('connector.freeEnd', args).ok, JSON.stringify(args)).toBe(false);
  });
});
