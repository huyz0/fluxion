// FR-LAY-001 (M17.17): the options form's model: fields from an options schema, a typed entry read back, whose layout is edited, and what is written.
import { APPLY_PATCH_COMMAND_ID } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { layoutTarget, type OptionField, optionFields, readOption, setLayoutOption, shownOption } from './layout-options.js';

const schema = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['horizontal', 'vertical'], default: 'vertical' },
    gap: { type: 'number', minimum: 0, default: 24 },
    columns: { type: 'integer', minimum: 1, maximum: 12 },
    wrap: { type: 'boolean', default: false },
    label: { type: 'string' },
    pins: { type: 'object' },
  },
};

describe('the layout options form model (FR-LAY-001)', () => {
  it('FR-LAY-001: an options schema gives one field per editable option, in order, with its default, bounds and choices', () => {
    expect(optionFields(schema)).toEqual([
      { key: 'direction', kind: 'choice', default: 'vertical', choices: ['horizontal', 'vertical'] },
      { key: 'gap', kind: 'number', default: 24, minimum: 0 },
      { key: 'columns', kind: 'integer', minimum: 1, maximum: 12 },
      { key: 'wrap', kind: 'boolean', default: false },
      { key: 'label', kind: 'text' },
    ]);
    expect(optionFields(undefined)).toEqual([]);
    expect(optionFields({ properties: [] })).toEqual([]);
  });

  it('FR-LAY-001: a typed entry is read within the bounds, a whole number for an integer, one of the words for a choice', () => {
    const [direction, gap, columns, wrap, label] = optionFields(schema) as [OptionField, OptionField, OptionField, OptionField, OptionField];
    expect(readOption(gap, ' 40 ')).toEqual({ ok: true, value: 40 });
    expect(readOption(gap, '-1').ok).toBe(false);
    expect(readOption(gap, 'wide').ok).toBe(false);
    expect(readOption(gap, '').ok).toBe(false);
    expect(readOption(columns, '2.5').ok).toBe(false);
    expect(readOption(columns, '13').ok).toBe(false);
    expect(readOption(columns, '3')).toEqual({ ok: true, value: 3 });
    expect(readOption(direction, 'horizontal')).toEqual({ ok: true, value: 'horizontal' });
    expect(readOption(direction, 'diagonal').ok).toBe(false);
    expect(readOption(wrap, true)).toEqual({ ok: true, value: true });
    expect(readOption(wrap, 'yes').ok).toBe(false);
    expect(readOption(label, 'x')).toEqual({ ok: true, value: 'x' });
    // the value shown is the option set, else the default
    expect(shownOption(gap, { gap: 8 })).toBe(8);
    expect(shownOption(gap, undefined)).toBe(24);
  });

  it('FR-LAY-001: the form edits the one selected group or frame with a layout, or the screen when nothing is selected', () => {
    const records: { [id: string]: unknown } = {
      S: { id: 'S', type: 'screen', layout: { type: 'grid' } },
      P: { id: 'P', type: 'screen' },
      G: { id: 'G', kind: 'group', layout: { type: 'stack', options: { gap: 8 } } },
      F: { id: 'F', kind: 'frame' },
      R: { id: 'R', kind: 'shape', layout: { type: 'stack' } },
    };
    const get = (id: string) => records[id];
    expect(layoutTarget(get, [], 'S')).toEqual({ kind: 'screen', id: 'S', spec: { type: 'grid' } });
    expect(layoutTarget(get, [], 'P')).toBeUndefined();
    expect(layoutTarget(get, [], undefined)).toBeUndefined();
    expect(layoutTarget(get, ['G'], 'S')).toEqual({ kind: 'container', id: 'G', spec: { type: 'stack', options: { gap: 8 } } });
    expect(layoutTarget(get, ['F'], 'S')).toBeUndefined();
    expect(layoutTarget(get, ['R'], 'S')).toBeUndefined();
    expect(layoutTarget(get, ['G', 'F'], 'S')).toBeUndefined();
  });

  it('FR-LAY-001: setting an option writes the spec and lays the target out again as an amend; a refused spec stops there', () => {
    const calls: Array<[string, unknown, unknown]> = [];
    const ok = (id: string, args: unknown, options?: unknown) => {
      calls.push([id, args, options]);
      return { ok: true };
    };
    const group = { kind: 'container', id: 'G', spec: { type: 'stack', live: true, options: { gap: 8 } } } as const;
    expect(setLayoutOption(ok, group, { screenId: 'S', key: 'direction', value: 'horizontal' })).toBe(true);
    const layout = { type: 'stack', live: true, options: { gap: 8, direction: 'horizontal' } };
    expect(calls).toEqual([
      ['element.update', { id: 'G', fields: { layout } }, undefined],
      ['layout.arrange', { screenId: 'S', scope: { containerId: 'G' }, algorithm: 'stack', options: layout.options }, { amend: true }],
    ]);
    calls.length = 0;
    expect(setLayoutOption(ok, { kind: 'screen', id: 'S', spec: { type: 'grid' } }, { screenId: 'S', key: 'columns', value: 3 })).toBe(true);
    expect(calls).toEqual([
      ['screen.setLayout', { id: 'S', layout: { type: 'grid', options: { columns: 3 } } }, undefined],
      ['layout.arrange', { screenId: 'S', scope: 'screen', algorithm: 'grid', options: { columns: 3 } }, { amend: true }],
    ]);
    calls.length = 0;
    const refuse = (id: string, args: unknown) => {
      calls.push([id, args, undefined]);
      return { ok: false };
    };
    expect(setLayoutOption(refuse, group, { screenId: 'S', key: 'gap', value: 4 })).toBe(false);
    expect(calls.map(([id]) => id)).toEqual(['element.update']);
  });

  it('FR-LAY-001: a template option builds the template again, in one patch with its id, items and the new options', () => {
    const calls: Array<[string, unknown]> = [];
    const execute = (id: string, args: unknown) => {
      calls.push([id, args]);
      return { ok: true };
    };
    const items = [{ label: 'Plan' }, { label: 'Ship' }];
    const target = { kind: 'screen', id: 'S', spec: { type: 'template', id: 'process.basic', items, options: { gap: 8 } } } as const;
    expect(setLayoutOption(execute, target, { screenId: 'S', key: 'direction', value: 'down' })).toBe(true);
    const layout = { type: 'template', id: 'process.basic', items, options: { gap: 8, direction: 'down' } };
    expect(calls).toEqual([[APPLY_PATCH_COMMAND_ID, { patch: { flux: 1, ops: [{ op: 'setLayout', scope: '#S', layout }] } }]]);
    expect(setLayoutOption(() => ({ ok: false }), target, { screenId: 'S', key: 'gap', value: 4 })).toBe(false);
  });
});
