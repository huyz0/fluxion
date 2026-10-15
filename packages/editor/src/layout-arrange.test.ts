// FR-LAY-005, FR-LAY-001: the editor's Arrange commands send the layout command the right scope; the layout itself is tested in @fluxion/layout and the studio.
import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { EDITOR_COMMANDS } from './editor-commands.js';
import { arrangeContainer, arrangeScreen, arrangeSelected, LAYOUT_CHOICES } from './layout-arrange.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

function setup(accept = true) {
  const b = documentBuilder({ seed: 1301 });
  const screen = b.screen({ size: { w: 1000, h: 600 } });
  const a = b.rect(screen, { x: 20, y: 100, w: 100, h: 50 });
  const c = b.rect(screen, { x: 200, y: 300, w: 100, h: 50 });
  const core = createCore(b.build());
  const group = 'GroupGroup000001' as RecordId;
  core.execute('element.group', { ids: [a, c], groupId: group });
  const session = createSession('doc');
  const calls: Array<{ id: string; args: unknown }> = [];
  const execute = (id: string, args: unknown) => {
    calls.push({ id, args });
    return accept ? { ok: true } : { ok: false };
  };
  const ctx = { session, view: core.store, execute } as unknown as ToolCtx;
  return { screen, a, c, group, session, ctx, calls };
}

describe('arranging with a layout in the editor (FR-LAY-005, FR-LAY-001)', () => {
  it('FR-LAY-005: the screen is laid out whole, and the selection among the rest, with the chosen layout', () => {
    const t = setup();
    expect(arrangeScreen(t.ctx, 'grid')).toBe(true);
    expect(t.calls[0]).toEqual({ id: 'layout.arrange', args: { screenId: t.screen, scope: 'screen', algorithm: 'grid' } });
    t.session.selection.set([t.a]);
    expect(arrangeSelected(t.ctx, 'stack')).toBe(false);
    t.session.selection.set([t.a, t.c]);
    expect(arrangeSelected(t.ctx, 'stack')).toBe(true);
    expect(t.calls[1]).toEqual({ id: 'layout.arrange', args: { screenId: t.screen, scope: 'selection', selection: [t.a, t.c], algorithm: 'stack' } });
  });

  it('FR-LAY-005: a selected group is laid out by its own layout; anything else is refused', () => {
    const t = setup();
    t.session.selection.set([t.a]);
    expect(arrangeContainer(t.ctx)).toBe(false);
    t.session.selection.set([t.group, t.a]);
    expect(arrangeContainer(t.ctx)).toBe(false);
    t.session.selection.set([t.group]);
    expect(arrangeContainer(t.ctx)).toBe(true);
    expect(t.calls).toEqual([{ id: 'layout.arrange', args: { screenId: t.screen, scope: { containerId: t.group } } }]);
  });

  it('FR-LAY-001: a refusal by the document comes back as false, and each choice has a screen and a selection command', () => {
    expect(arrangeScreen(setup(false).ctx, 'layered')).toBe(false);
    const ids = EDITOR_COMMANDS.map((c) => c.id);
    for (const [name] of LAYOUT_CHOICES) expect(ids).toEqual(expect.arrayContaining([`layout.arrange.screen.${name}`, `layout.arrange.selection.${name}`]));
    expect(ids).toContain('layout.arrange.container');
  });
});
