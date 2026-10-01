import { createCore } from '@fluxion/core';
import type { FieldDef, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { applyField, inspect } from './inspector-model.js';

const red = '#ff0000';
const blue = '#0000ff';

function setup() {
  const b = documentBuilder({ seed: 15 });
  const s = b.screen();
  const a = b.rect(s, { x: 10, y: 20, w: 100, h: 50, style: { fill: red, opacity: 0.5 } });
  const c = b.rect(s, { x: 30, y: 20, w: 100, h: 60, style: { fill: red } });
  const d = b.rect(s, { x: 50, y: 20, w: 100, h: 70, style: { fill: blue } });
  const t = b.text(s, 'hi', { x: 70, y: 20, w: 100, h: 30 });
  const line = b.connect(a, c);
  const core = createCore(b.build());
  return { core, a, c, d, t, line, s };
}
const field = (model: ReturnType<typeof inspect>, path: string) => model?.groups.flatMap((g) => g.fields).find((f) => f.def.path.join('.') === path);
const record = (core: ReturnType<typeof setup>['core'], id: RecordId) =>
  core.store.get(id) as unknown as { style: { [k: string]: unknown }; transform: { [k: string]: unknown } };

describe('inspector model (FR-EDT-008)', () => {
  it('FR-EDT-008: a multi-selection`s inspector shows the fields they share, mixed where they differ', () => {
    const { core, a, c, d } = setup();
    const model = inspect(core.store, [a, c, d]);
    expect(model?.ids).toEqual([a, c, d]);
    expect(field(model, 'transform.x')).toMatchObject({ mixed: true, value: undefined });
    expect(field(model, 'transform.y')).toMatchObject({ mixed: false, value: 20 });
    expect(field(model, 'transform.w')).toMatchObject({ mixed: false, value: 100 });
    expect(field(model, 'style.fill')?.mixed).toBe(true);
    // only one of three sets an opacity: mixed too
    expect(field(model, 'style.opacity')?.mixed).toBe(true);
    // two with the same fill agree
    expect(field(inspect(core.store, [a, c]), 'style.fill')).toMatchObject({ mixed: false, value: red });
    // a field none of them sets is shared, without a value
    expect(field(inspect(core.store, [c, d]), 'style.opacity')).toMatchObject({ mixed: false, value: undefined });
    // the sections come in the usual order
    expect(model?.groups.map((g) => g.name).slice(0, 3)).toEqual(['Element', 'Layout', 'Fill']);
  });

  it('FR-EDT-008: only fields every element has stay: a connector and a shape share name, hidden and stroke, not the box', () => {
    const { core, a, line, t } = setup();
    const paths = (ids: readonly RecordId[]) => (inspect(core.store, ids)?.groups ?? []).flatMap((g) => g.fields.map((f) => f.def.path.join('.')));
    expect(paths([a, line])).toEqual(expect.arrayContaining(['name', 'hidden', 'style.stroke.color']));
    expect(paths([a, line])).not.toContain('transform.x');
    expect(paths([a, t])).toContain('transform.x');
    expect(paths([a, t])).not.toContain('textFit.mode');
    expect(paths([a])).toContain('textFit.mode');
  });

  it('FR-EDT-008: an empty selection, a screen and a record that went have no inspector', () => {
    const { core, s, a } = setup();
    expect(inspect(core.store, [])).toBeUndefined();
    expect(inspect(core.store, [s])).toBeUndefined();
    expect(inspect(core.store, ['gone' as RecordId])).toBeUndefined();
    expect(inspect(core.store, ['gone' as RecordId, a])?.ids).toEqual([a]);
  });

  it('FR-EDT-008: an `inspectors` override replaces the fields of its kind', () => {
    const { core, a, c } = setup();
    const only: FieldDef = { path: ['name'], ui: 'text', group: 'Mine', order: 1, label: 'Name' };
    const model = inspect(core.store, [a], { get: (kind) => (kind === 'shape' ? () => [only] : undefined) });
    expect(model?.groups).toEqual([{ name: 'Mine', fields: [{ def: only, value: undefined, mixed: false }] }]);
    const narrowed = inspect(core.store, [a, c], { get: (kind) => (kind === 'shape' ? (f) => f.filter((x) => x.path[0] === 'name') : undefined) });
    expect(narrowed?.groups.flatMap((g) => g.fields.map((f) => f.def.label))).toEqual(['Name']);
  });

  it('FR-EDT-008: a mixed fill set on 3 shapes updates all 3 in one undo step', () => {
    const { core, a, c, d } = setup();
    const green = '#00ff00';
    const command = applyField(core.store, [a, c, d], ['style', 'fill'], green);
    expect(command?.id).toBe('element.updateMany');
    expect(core.execute(command?.id as string, command?.args).ok).toBe(true);
    for (const id of [a, c, d]) expect(record(core, id).style['fill']).toEqual(green);
    // the rest of the style stays
    expect(record(core, a).style['opacity']).toBe(0.5);
    expect(field(inspect(core.store, [a, c, d]), 'style.fill')?.mixed).toBe(false);
    // one undo puts all three back
    core.store.history.undo();
    expect([a, c, d].map((id) => record(core, id).style['fill'])).toEqual([red, red, blue]);
  });

  it('FR-EDT-008: a nested value is set without touching its siblings, and undefined removes the field', () => {
    const { core, a } = setup();
    const run = (path: string[], value: unknown) => {
      const command = applyField(core.store, [a], path, value);
      core.execute(command?.id as string, command?.args);
    };
    run(['transform', 'x'], 99);
    expect(record(core, a).transform).toMatchObject({ x: 99, y: 20, w: 100, h: 50 });
    run(['style', 'opacity'], undefined);
    expect(Object.hasOwn(record(core, a).style, 'opacity')).toBe(false);
    expect(record(core, a).style['fill']).toEqual(red);
    // an object that is not there yet is made
    run(['style', 'stroke', 'width'], 3);
    expect(record(core, a).style['stroke']).toEqual({ width: 3 });
    // nothing selected, or no path: no command
    expect(applyField(core.store, [], ['name'], 'x')).toBeUndefined();
    expect(applyField(core.store, [a], [], 'x')).toBeUndefined();
  });
});
