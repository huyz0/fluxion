import { describe, expect, it } from 'vitest';
import { type Rec, remapRecord, scrubRecord } from './remap.js';

const rec = (r: Record<string, unknown>): Rec => r as unknown as Rec;
const ids = new Map([['old', 'new']]);
/** The `then` branch of an `if` action (a key the linter reads as a promise's). */
const branch = (actions: readonly object[]): object => Object.fromEntries([['then', actions]]);

describe('source view, id remap', () => {
  it('FR-EDT-022: a remap rewrites the own id and the element ids of every record type that points at one', () => {
    const pointing: readonly (readonly [string, Record<string, unknown>, Record<string, unknown>])[] = [
      ['element.parentId', { id: 'e', type: 'element', parentId: 'old' }, { id: 'e', type: 'element', parentId: 'new' }],
      ['element.screenId', { id: 'e', type: 'element', screenId: 'old' }, { id: 'e', type: 'element', screenId: 'new' }],
      ['binding.elementId', { id: 'b', type: 'binding', elementId: 'old', connectorId: 'c' }, { id: 'b', type: 'binding', elementId: 'new', connectorId: 'c' }],
      [
        'binding.connectorId',
        { id: 'b', type: 'binding', elementId: 'e', connectorId: 'old' },
        { id: 'b', type: 'binding', elementId: 'e', connectorId: 'new' },
      ],
      ['comment.targetId', { id: 'm', type: 'comment', targetId: 'old' }, { id: 'm', type: 'comment', targetId: 'new' }],
      ['interaction.ownerId', { id: 'i', type: 'interaction', ownerId: 'old' }, { id: 'i', type: 'interaction', ownerId: 'new' }],
      [
        'interaction actions and trigger',
        {
          id: 'i',
          type: 'interaction',
          ownerId: 'x',
          trigger: { on: 'riderArrive', connectorId: 'old' },
          actions: [
            { do: 'toggle', targets: ['a', 'old'] },
            { do: 'zoomTo', target: 'old' },
          ],
        },
        {
          id: 'i',
          type: 'interaction',
          ownerId: 'x',
          trigger: { on: 'riderArrive', connectorId: 'new' },
          actions: [
            { do: 'toggle', targets: ['a', 'new'] },
            { do: 'zoomTo', target: 'new' },
          ],
        },
      ],
      [
        'step.animations targets',
        { id: 's', type: 'step', timelineId: 't', animations: [{ effect: 'appear', targets: ['old'] }] },
        { id: 's', type: 'step', timelineId: 't', animations: [{ effect: 'appear', targets: ['new'] }] },
      ],
      ['screen.parentElementId', { id: 'sc', type: 'screen', parentElementId: 'old' }, { id: 'sc', type: 'screen', parentElementId: 'new' }],
      ['screen.masterId', { id: 'sc', type: 'screen', masterId: 'old' }, { id: 'sc', type: 'screen', masterId: 'new' }],
      ['timeline.screenId', { id: 't', type: 'timeline', screenId: 'old' }, { id: 't', type: 'timeline', screenId: 'new' }],
      ['own id', { id: 'old', type: 'element' }, { id: 'new', type: 'element' }],
    ];
    for (const [name, before, after] of pointing) expect(remapRecord(rec(before), ids), name).toEqual(after);
  });

  it('FR-EDT-022: a remap leaves a record that holds no old id as the same object, rewrites whole strings only, and never a key', () => {
    const untouched = rec({ id: 'e', type: 'element', semantic: { label: 'old' + 'x', slug: 'old-x' }, transform: { x: 1 } });
    expect(remapRecord(untouched, ids)).toBe(untouched);
    expect(remapRecord(rec({ id: 'e', type: 'element', old: 1 }), ids)).toEqual({ id: 'e', type: 'element', old: 1 });
  });

  it('FR-EDT-022: a scrub deletes the record that is owned by a gone one, drops a gone id from a list and an action that needs one', () => {
    const gone = new Set(['old']);
    expect(scrubRecord(rec({ id: 'm', type: 'comment', targetId: 'old' }), gone)).toEqual({ record: undefined, changed: true });
    expect(scrubRecord(rec({ id: 'i', type: 'interaction', ownerId: 'old', actions: [] }), gone).record).toBeUndefined();
    expect(scrubRecord(rec({ id: 'b', type: 'binding', elementId: 'old', connectorId: 'c' }), gone).record).toBeUndefined();
    const step = rec({ id: 's', type: 'step', animations: [{ effect: 'appear', targets: ['a', 'old'] }] });
    expect(scrubRecord(step, gone)).toEqual({ record: { id: 's', type: 'step', animations: [{ effect: 'appear', targets: ['a'] }] }, changed: true });
    const interaction = rec({
      id: 'i',
      type: 'interaction',
      ownerId: 'x',
      trigger: { on: 'click' },
      actions: [{ do: 'zoomTo', target: 'old' }, { do: 'next' }, { do: 'if', cond: 'x', ...branch([{ do: 'zoomTo', target: 'old' }, { do: 'back' }]) }],
    });
    expect(scrubRecord(interaction, gone).record).toEqual({
      id: 'i',
      type: 'interaction',
      ownerId: 'x',
      trigger: { on: 'click' },
      actions: [{ do: 'next' }, { do: 'if', cond: 'x', ...branch([{ do: 'back' }]) }],
    });
    // a trigger that needs the gone element leaves the interaction nothing to start it
    expect(
      scrubRecord(rec({ id: 'i', type: 'interaction', ownerId: 'x', trigger: { on: 'riderArrive', connectorId: 'old' }, actions: [] }), gone).record,
    ).toBeUndefined();
  });

  it('FR-EDT-022: a scrub leaves a record that points at nothing gone as the same object', () => {
    const r = rec({ id: 'm', type: 'comment', targetId: 'live', body: 'old' });
    expect(scrubRecord(r, new Set(['old2']))).toEqual({ record: r, changed: false });
    expect(scrubRecord(r, new Set(['old2'])).record).toBe(r);
    // the own id is the caller's business
    expect(scrubRecord(rec({ id: 'old', type: 'comment', targetId: 'live' }), new Set(['old'])).changed).toBe(false);
  });
});
