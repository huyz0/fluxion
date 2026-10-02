// Shared fixture of the core benches (NFR-PERF-006): a 5 000-record document from the schema
// builders, a store with default options (validation on, as in dev and test; ADR-0014) and the core
// hooks, and one succeeding argument set per built-in command.
import { type AnyRecord, keyBetween, nKeysBetween, type RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { registerCoreCommands } from '../src/builtin-commands.js';
import { type AnyCommand, executeCommand } from '../src/commands.js';
import { type IntegrityHook, registerCoreHooks } from '../src/hooks.js';
import { createRegistry } from '../src/registry.js';
import { createStore, type Store } from '../src/store.js';

/**
 * Sampling of every bench: 3 s after a 0.5 s warm-up (about 600 samples at ~5 ms), so a p99 is not
 * decided by one or two GC or scheduler pauses the way ~190 samples of tinybench's 1 s default are
 * (M4.7: the shared gate leg judges these p99s at every milestone end).
 */
export const RUN_OPTIONS = { time: 3_000, warmupTime: 500 } as const;

/** Records in the bench document (NFR-PERF-006: ≤ 5 000 records). */
export const RECORDS = 5_000;

export type Bench = {
  readonly store: Store;
  /** Run `command` with its bench arguments; throws when it is refused, so no bench times a no-op. */
  run(command: string): void;
};

/** A fresh store over a 5 000-record document (10 screens of rects joined by bound connectors). */
export function benchStore(): Bench {
  const b = documentBuilder({ seed: 5000 });
  const screens: RecordId[] = [];
  const shapes: RecordId[] = [];
  const lines: RecordId[] = [];
  for (let s = 0; s < 10; s++) {
    const screen = b.screen({ name: `screen ${s}` });
    screens.push(screen);
    const rects: RecordId[] = [];
    for (let i = 0; i < 250; i++) rects.push(b.rect(screen, { x: (i % 25) * 60, y: Math.floor(i / 25) * 60 }));
    // each connector adds three records: itself and the bindings of its two ends
    for (let i = 0; i < 83; i++) lines.push(b.connect(rects[i] as RecordId, rects[i + 1] as RecordId));
    shapes.push(...rects);
  }
  const built = b.build();
  // a group of three shapes of screen 6, for element.ungroup to act on
  const file = withGroup(built, screens[6] as RecordId, shapes.slice(1500, 1503));
  const count = Object.keys(file.records).length;
  if (count < RECORDS) throw new Error(`bench document has ${count} records, want ${RECORDS}`);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = createStore(file, { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const args = benchArgs(screens, shapes, lines);
  return {
    store,
    run(command) {
      const r = executeCommand(commands, { store }, command, args[command]);
      if (!r.ok) throw new Error(`${command} refused: ${r.error.message}`);
    },
  };
}

/** `file` with a group (BENCH_GROUP) on `screen` holding `members`, which are patched to name it as their parent. */
function withGroup(file: ReturnType<ReturnType<typeof documentBuilder>['build']>, screen: RecordId, members: readonly RecordId[]) {
  const topLevel = Object.values(file.records).filter(
    (r) => (r as { screenId?: unknown }).screenId === screen && (r as { parentId?: unknown }).parentId === undefined,
  );
  const last = topLevel
    .map((r) => String((r as { index?: unknown }).index ?? ''))
    .sort()
    .at(-1) as string;
  const index = keyBetween(last, null);
  if (!index.ok) throw new Error(index.error.message);
  const records: Record<string, unknown> = { ...file.records };
  for (const m of members) records[m] = { ...(records[m] as object), parentId: BENCH_GROUP };
  records[BENCH_GROUP] = {
    id: BENCH_GROUP,
    type: 'element',
    kind: 'group',
    screenId: screen,
    index: index.value,
    transform: { x: 0, y: 0, w: 200, h: 60, rot: 0 },
  } as AnyRecord;
  return { ...file, records } as typeof file;
}

/** The group the fixture holds. */
const BENCH_GROUP = 'BenchGroup0000001' as RecordId;

/** Fractional index keys for the 25 elements of element.createMany. */
const MANY_KEYS = (() => {
  const keys = nKeysBetween(null, null, 25);
  if (!keys.ok) throw new Error('no keys');
  return keys.value;
})();

/** Arguments that succeed against the fixture document (and again after the command is undone). */
function benchArgs(screens: readonly RecordId[], shapes: readonly RecordId[], lines: readonly RecordId[]): Record<string, unknown> {
  const screen = screens[3] as RecordId;
  return {
    'element.create': {
      element: {
        id: 'BenchNewElem00001',
        type: 'element',
        kind: 'shape',
        defId: 'basic:rect',
        screenId: screen,
        index: 'a0',
        transform: { x: 0, y: 0, w: 10, h: 10 },
      },
    },
    'element.update': { id: shapes[1200], fields: { name: 'renamed' } },
    // a moved selection: 25 shapes, bound ones among them
    'element.updateMany': {
      updates: shapes.slice(1000, 1025).map((s, i) => ({ id: s, fields: { transform: { x: i * 60 + 5, y: 5, w: 160, h: 80 } } })),
    },
    // a duplicated selection: 25 new shapes
    'element.createMany': {
      elements: Array.from({ length: 25 }, (_, i) => ({
        id: `BenchNewMany${String(i).padStart(5, '0')}`,
        type: 'element',
        kind: 'shape',
        defId: 'basic:rect',
        screenId: screen,
        index: MANY_KEYS[i] as string,
        transform: { x: i * 10, y: 0, w: 10, h: 10 },
      })),
    },
    // a bound shape: the delete cascades to its bindings through the hooks
    'element.delete': { ids: [shapes[1001]] },
    'screen.create': { screen: { id: 'BenchNewScreen001', type: 'screen', index: 'a0' } },
    // an empty screen would be cheaper; this one holds 499 records (the cascade is part of the cost)
    'screen.delete': { id: screens[7] },
    'screen.reorder': { id: screens[2], after: screens[8] },
    'binding.set': { id: 'BenchNewBinding01', connectorId: lines[500], end: 'target', elementId: shapes[2400], anchor: { kind: 'auto' } },
    // two siblings of screen 5 grouped, and the fixture's group dissolved
    'element.group': { ids: [shapes[1300], shapes[1301]], groupId: 'BenchNewGroup0001' },
    'element.ungroup': { ids: [BENCH_GROUP] },
    // two shapes of screen 5 aligned by their left edges
    'element.align': { ids: [shapes[1400], shapes[1401]], mode: 'left', to: 'selection' },
    // five shapes of screen 5 spaced evenly
    'element.distribute': { ids: shapes.slice(1410, 1415), axis: 'horizontal', by: 'gaps' },
    // a shape of screen 5 to the front
    'element.zOrder': { ids: [shapes[1420]], to: 'front' },
    'connector.freeEnd': { connectorId: lines[501], end: 'source', at: { x: 5, y: 6 } },
    'document.update': { fields: { title: 'bench' } },
    'asset.create': { asset: { id: 'BenchNewAsset0001', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 1, name: 'bench.png' } },
  };
}

/** The built-in record commands (M3.17), in the order the benches report them. */
export const COMMANDS = [
  'element.create',
  'element.createMany',
  'element.update',
  'element.updateMany',
  'element.delete',
  'screen.create',
  'screen.delete',
  'screen.reorder',
  'binding.set',
  'connector.freeEnd',
  'element.group',
  'element.ungroup',
  'element.align',
  'element.distribute',
  'element.zOrder',
  'document.update',
  'asset.create',
] as const;
