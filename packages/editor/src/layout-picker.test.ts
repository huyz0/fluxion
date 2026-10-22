// FR-LAY-003, FR-LAY-010 (M17.18): the layout picker's model: what a pick applies to, what it writes, and "Make live".
import { describe, expect, it } from 'vitest';
import { canBeLive, chosenLayout, pickLayout, pickTarget, setLive } from './layout-picker.js';

const records: { [id: string]: unknown } = {
  S: { id: 'S', type: 'screen' },
  L: { id: 'L', type: 'screen', layout: { type: 'grid' } },
  G: { id: 'G', kind: 'group' },
  F: { id: 'F', kind: 'frame', layout: { type: 'stack', live: true, options: { gap: 8 } } },
  R: { id: 'R', kind: 'shape' },
};
const get = (id: string) => records[id];

function runner(ok = true) {
  const calls: Array<[string, unknown, unknown]> = [];
  const execute = (id: string, args: unknown, options?: unknown) => {
    calls.push([id, args, options]);
    return { ok };
  };
  return { calls, execute };
}

describe('the layout picker model (FR-LAY-003, FR-LAY-010)', () => {
  it('FR-LAY-003: a pick applies to the selected group or frame, the shown screen, or two or more elements; not to one shape', () => {
    expect(pickTarget(get, [], 'S')).toEqual({ kind: 'screen', id: 'S' });
    expect(pickTarget(get, [], 'L')).toEqual({ kind: 'screen', id: 'L', spec: { type: 'grid' } });
    expect(pickTarget(get, ['G'], 'S')).toEqual({ kind: 'container', id: 'G' });
    expect(pickTarget(get, ['F'], 'S')).toEqual({ kind: 'container', id: 'F', spec: records['F'] && { type: 'stack', live: true, options: { gap: 8 } } });
    expect(pickTarget(get, ['R'], 'S')).toBeUndefined();
    expect(pickTarget(get, ['R', 'G'], 'S')).toEqual({ kind: 'selection', ids: ['R', 'G'] });
    expect(pickTarget(get, [], undefined)).toBeUndefined();
    expect(chosenLayout({ kind: 'screen', id: 'L', spec: { type: 'grid' } })).toBe('grid');
    expect(chosenLayout({ kind: 'screen', id: 'S' })).toBe('');
    expect(chosenLayout({ kind: 'selection', ids: ['R', 'G'] })).toBe('');
    // a built template has the type `template`, which is no choice of the picker
    expect(chosenLayout({ kind: 'screen', id: 'S', spec: { type: 'template', id: 'process.basic' } })).toBe('template');
  });

  it('FR-LAY-003: a pick on a group stores the layout (live stays, options start over) and lays it out as an amend', () => {
    const { calls, execute } = runner();
    const target = pickTarget(get, ['F'], 'S');
    expect(pickLayout(execute, target as NonNullable<typeof target>, { screenId: 'S', algorithm: 'radial' })).toBe(true);
    expect(calls).toEqual([
      ['element.update', { id: 'F', fields: { layout: { type: 'radial', live: true } } }, undefined],
      ['layout.arrange', { screenId: 'S', scope: { containerId: 'F' }, algorithm: 'radial' }, { amend: true }],
    ]);
  });

  it('FR-LAY-003: a pick on the screen stores it with screen.setLayout; on a selection it lays them out once, nothing stored', () => {
    const screen = runner();
    expect(pickLayout(screen.execute, { kind: 'screen', id: 'S' }, { screenId: 'S', algorithm: 'grid' })).toBe(true);
    expect(screen.calls).toEqual([
      ['screen.setLayout', { id: 'S', layout: { type: 'grid' } }, undefined],
      ['layout.arrange', { screenId: 'S', scope: 'screen', algorithm: 'grid' }, { amend: true }],
    ]);
    const some = runner();
    expect(pickLayout(some.execute, { kind: 'selection', ids: ['A', 'B'] }, { screenId: 'S', algorithm: 'radial' })).toBe(true);
    expect(some.calls).toEqual([['layout.arrange', { screenId: 'S', scope: 'selection', selection: ['A', 'B'], algorithm: 'radial' }, undefined]]);
    const refused = runner(false);
    expect(pickLayout(refused.execute, { kind: 'container', id: 'G' }, { screenId: 'S', algorithm: 'grid' })).toBe(false);
    expect(refused.calls.map(([id]) => id)).toEqual(['element.update']);
    expect(pickLayout(runner(false).execute, { kind: 'selection', ids: ['A', 'B'] }, { screenId: 'S', algorithm: 'grid' })).toBe(false);
  });

  it('FR-LAY-010: Make live is for a group or frame that has a layout, and sets or clears only the live flag', () => {
    const live = pickTarget(get, ['F'], 'S') as NonNullable<ReturnType<typeof pickTarget>>;
    const none = pickTarget(get, ['G'], 'S') as NonNullable<ReturnType<typeof pickTarget>>;
    expect(canBeLive(live)).toBe(true);
    expect(canBeLive(none)).toBe(false);
    expect(canBeLive({ kind: 'screen', id: 'L', spec: { type: 'grid' } })).toBe(false);
    const off = runner();
    expect(setLive(off.execute, live, false)).toBe(true);
    expect(off.calls).toEqual([['element.update', { id: 'F', fields: { layout: { type: 'stack', options: { gap: 8 } } } }, undefined]]);
    const on = runner();
    expect(setLive(on.execute, { kind: 'container', id: 'F', spec: { type: 'stack' } }, true)).toBe(true);
    expect(on.calls).toEqual([['element.update', { id: 'F', fields: { layout: { type: 'stack', live: true } } }, undefined]]);
    expect(setLive(runner().execute, none, true)).toBe(false);
    expect(setLive(runner(false).execute, live, true)).toBe(false);
  });
});
