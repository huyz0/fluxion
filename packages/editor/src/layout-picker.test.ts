// FR-LAY-003, FR-LAY-010 (M17.18): the layout picker's model: what a pick applies to, what it writes, and "Make live".

import { APPLY_PATCH_COMMAND_ID } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { canBeLive, chosenChoice, chosenLayout, pickLayout, pickTarget, pickTemplate, registeredTemplateIds, screenItems, setLive } from './layout-picker.js';

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

  it('FR-LAY-014: the template ids are the registry entries that carry an id, sorted; a built template is the choice template:<id>', () => {
    expect(
      registeredTemplateIds([
        ['venn', { id: 'venn' }],
        ['process.basic', { id: 'process.basic' }],
        ['junk', 3],
      ]),
    ).toEqual(['process.basic', 'venn']);
    expect(chosenChoice({ kind: 'screen', id: 'S', spec: { type: 'template', id: 'process.basic' } })).toBe('template:process.basic');
    expect(chosenChoice({ kind: 'screen', id: 'S', spec: { type: 'grid' } })).toBe('grid');
    expect(chosenChoice({ kind: 'selection', ids: ['A', 'B'] })).toBe('');
  });

  it('FR-LAY-014: the items of a template are the labels of the top-level shapes in order; connectors, children and unlabelled shapes give none', () => {
    const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const rows: { [id: string]: unknown } = {
      a: { id: 'a', type: 'element', kind: 'shape', index: 'a2', text: rich('Ship') },
      b: { id: 'b', type: 'element', kind: 'shape', index: 'a1', semantic: { label: 'Plan' }, text: rich('ignored') },
      c: { id: 'c', type: 'element', kind: 'connector', index: 'a3', semantic: { label: 'edge' } },
      d: { id: 'd', type: 'element', kind: 'shape', index: 'a4', parentId: 'g', text: rich('inner') },
      e: { id: 'e', type: 'element', kind: 'shape', index: 'a5' },
    };
    expect(screenItems((id) => rows[id], ['a', 'b', 'c', 'd', 'e', 'gone'])).toEqual([
      { id: 'b', label: 'Plan' },
      { id: 'a', label: 'Ship' },
    ]);
  });

  it('FR-LAY-014: a template is built into the screen by one patch from the items; not into a group, and not without items', () => {
    const { calls, execute } = runner();
    expect(
      pickTemplate(
        execute,
        { kind: 'screen', id: 'S' },
        {
          templateId: 'process.basic',
          items: [
            { id: 'p', label: 'Plan' },
            { id: 'q', label: 'Ship' },
          ],
        },
      ),
    ).toBe(true);
    const layout = { type: 'template', id: 'process.basic', items: [{ label: 'Plan' }, { label: 'Ship' }] };
    const removes = [
      { op: 'remove', target: '#p', cascade: true },
      { op: 'remove', target: '#q', cascade: true },
    ];
    expect(calls).toEqual([[APPLY_PATCH_COMMAND_ID, { patch: { flux: 1, ops: [...removes, { op: 'setLayout', scope: '#S', layout }] } }, undefined]]);
    calls.length = 0;
    expect(pickTemplate(execute, { kind: 'container', id: 'G' }, { templateId: 'process.basic', items: [{ id: 'p', label: 'Plan' }] })).toBe(false);
    expect(pickTemplate(execute, { kind: 'screen', id: 'S' }, { templateId: 'process.basic', items: [] })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('FR-LAY-007: with the host port a pick writes the spec and sends the arrange to the port (amend for a stored layout, none for a selection)', () => {
    const { calls, execute } = runner();
    const sent: unknown[] = [];
    const port = async (request: unknown) => {
      sent.push(request);
      return { ok: true };
    };
    expect(pickLayout(execute, { kind: 'screen', id: 'S' }, { screenId: 'S', algorithm: 'grid' }, port)).toBe(true);
    expect(calls.map(([id]) => id)).toEqual(['screen.setLayout']);
    expect(pickLayout(execute, { kind: 'selection', ids: ['A', 'B'] }, { screenId: 'S', algorithm: 'radial' }, port)).toBe(true);
    expect(calls.map(([id]) => id)).toEqual(['screen.setLayout']);
    expect(sent).toEqual([
      { screenId: 'S', scope: 'screen', algorithm: 'grid', amend: true },
      { screenId: 'S', scope: 'selection', selection: ['A', 'B'], algorithm: 'radial' },
    ]);
    // a refused spec sends nothing
    sent.length = 0;
    expect(pickLayout(runner(false).execute, { kind: 'screen', id: 'S' }, { screenId: 'S', algorithm: 'grid' }, port)).toBe(false);
    expect(sent).toEqual([]);
  });
});
