import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';
import { screenRecordsToCopy } from './screen-commands.js';

function fixture() {
  const b = documentBuilder({ seed: 640 });
  const screen = b.screen();
  const outside = b.screen();
  const left = b.rect(screen);
  const right = b.rect(outside, { x: 400, y: 300 });
  const outgoing = b.connect(left, right);
  const incoming = b.connect(right, left);
  const free = b.connect(left, { x: 30, y: 80 });
  const both = b.connect(right, right);
  b.connect(right, left); // outside connector remains outside, even though its target is selected
  const file = b.build();
  const core = createCore({
    ...file,
    records: {
      ...file.records,
      [incoming]: { ...(file.records[incoming] as AnyRecord), screenId: screen, index: 'a3' },
      [both]: { ...(file.records[both] as AnyRecord), screenId: screen, index: 'a4' },
    },
  } as typeof file);
  const selected = screenRecordsToCopy(core.store, screen);
  const ids = Object.fromEntries(selected.map((id, i) => [id, `Copy${String(i).padStart(12, '0')}`]));
  const args = { id: screen, newId: 'NewScreen00000001', ids };
  const freeEnds = {
    [outgoing]: { target: { x: 450.5, y: 375.25 } },
    [incoming]: { source: { x: -80.5, y: 210.25 } },
    [both]: { source: { x: 33.5, y: 71.25 }, target: { x: -19.5, y: 82.25 } },
  };
  const get = (id: string) => core.store.get(id as RecordId) as unknown as Record<string, unknown>;
  return { ...core, args, freeEnds, incoming, outgoing, both, free, get };
}

it('FR-SCR-002, FR-CON-001: duplicate frees outside-bound ends at supplied points, preserves internal/free ends and undoes exactly', () => {
  const t = fixture();
  const before = t.store.toDocument();
  const bindings = t.store.members('byType', 'binding').map(t.get);
  const events: string[] = [];
  t.store.subscribe((_diff, meta) => events.push(meta.label));
  expect(t.execute('screen.duplicate', { ...t.args, freeEnds: t.freeEnds }).ok).toBe(true);
  expect(events).toEqual(['screen.duplicate']);
  expect(t.get(t.args.ids[t.outgoing] as string)['freeTarget']).toEqual(t.freeEnds[t.outgoing]?.target);
  expect(t.get(t.args.ids[t.incoming] as string)['freeSource']).toEqual(t.freeEnds[t.incoming]?.source);
  expect(t.get(t.args.ids[t.both] as string)).toMatchObject({ freeSource: t.freeEnds[t.both]?.source, freeTarget: t.freeEnds[t.both]?.target });
  expect(t.get(t.args.ids[t.free] as string)['freeTarget']).toEqual({ x: 30, y: 80 });
  for (const binding of bindings) {
    expect(t.get(String(binding['id']))).toEqual(binding);
    const copied = t.args.ids[String(binding['id'])];
    if (copied)
      expect(t.get(copied)).toEqual({
        ...binding,
        id: copied,
        connectorId: t.args.ids[String(binding['connectorId'])],
        elementId: t.args.ids[String(binding['elementId'])],
      });
  }
  for (const [id, record] of Object.entries(before.records)) expect(t.get(id)).toEqual(record);
  const after = t.store.toDocument();
  t.store.history.undo();
  expect(t.store.toDocument()).toEqual(before);
  t.store.history.redo();
  expect(t.store.toDocument()).toEqual(after);
});

it('FR-SCR-002, FR-CON-001: missing or malformed duplicate endpoint geometry refuses atomically with exact argument paths', () => {
  const t = fixture();
  const before = t.store.toDocument();
  const events: string[] = [];
  t.store.subscribe((_diff, meta) => events.push(meta.label));
  const cases = [
    [undefined, `/args/freeEnds/${t.outgoing}/target`],
    [{}, `/args/freeEnds/${t.outgoing}/target`],
    [{ [t.outgoing]: {} }, `/args/freeEnds/${t.outgoing}/target`],
    [{ [t.outgoing]: t.freeEnds[t.outgoing] }, `/args/freeEnds/${t.incoming}/source`],
    [{ ...t.freeEnds, [t.outgoing]: { target: { x: Infinity, y: 1 } } }, `/args/freeEnds/${t.outgoing}/target/x`],
    [{ ...t.freeEnds, [t.incoming]: { source: { x: 1, y: NaN } } }, `/args/freeEnds/${t.incoming}/source/y`],
  ] as const;
  for (const [freeEnds, path] of cases) {
    const result = t.execute('screen.duplicate', { ...t.args, freeEnds });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_ARGS',
        message: expect.stringMatching(/^screen\.duplicate: \S/),
        diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path, message: expect.stringMatching(/\S/) }],
      },
    });
    expect(t.store.toDocument()).toEqual(before);
    expect(events).toEqual([]);
  }
});
