// FR-LAY-005, FR-LAY-001: the editor's Arrange commands send the layout command the right scope; the layout itself is tested in @fluxion/layout and the studio.
import { createCore } from '@fluxion/core';
import { safeAreaOf, screenFrame } from '@fluxion/layout';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { menuItems } from './context-menu-model.js';
import { EDITOR_COMMANDS, type EditorCommandCtx, registeredLayoutCommands } from './editor-commands.js';
import {
  type ArrangeOutcome,
  type ArrangeRequest,
  arrangeContainer,
  arrangeScreen,
  arrangeSelected,
  fitToScreen,
  LAYOUT_CHOICES,
  registeredLayoutIds,
} from './layout-arrange.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

function setup(accept = true, background?: (request: ArrangeRequest) => Promise<ArrangeOutcome>) {
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
  const tool = { session, view: core.store, execute } as unknown as ToolCtx;
  const notices: string[] = [];
  const ctx = {
    mode: 'edit',
    tools: { ctx: tool },
    notify: (m: string) => void notices.push(m),
    ...(background ? { arrange: background } : {}),
  } as unknown as EditorCommandCtx;
  return { core, screen, a, c, group, session, ctx, calls, notices };
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

  it('FR-LAY-007: with a background runner the Arrange is taken at once, says it is working, and then clears or says why it failed', async () => {
    const requests: ArrangeRequest[] = [];
    let finish: (o: ArrangeOutcome) => void = () => undefined;
    const t = setup(true, (request) => {
      requests.push(request);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    expect(arrangeScreen(t.ctx, 'layered')).toBe(true);
    expect(requests).toEqual([{ screenId: t.screen, scope: 'screen', algorithm: 'layered' }]);
    expect(t.calls).toEqual([]);
    expect(t.notices).toEqual(['Arranging…']);
    finish({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.notices).toEqual(['Arranging…', '']);
    const failing = setup(true, () => Promise.resolve({ ok: false, message: 'the screen changed' }));
    expect(arrangeScreen(failing.ctx, 'grid')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(failing.notices).toEqual(['Arranging…', 'Could not arrange: the screen changed']);
    const cancelled = setup(true, () => Promise.reject(new Error('superseded by revision 2')));
    arrangeScreen(cancelled.ctx, 'grid');
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelled.notices.at(-1)).toBe('Could not arrange: superseded by revision 2');
  });

  it('FR-LAY-001: a layout a plugin registers gets Arrange commands that run layout.arrange with its name, and the menus list them', () => {
    const entries = [
      ['grid', { id: 'grid' }],
      ['layered', { id: 'layered' }],
      ['stack', { id: 'stack' }],
      ['test:ring', { id: 'test:ring' }],
      ['not-a-layout', 'text'],
    ] as const;
    expect(registeredLayoutIds(entries)).toEqual(['test:ring']);
    const added = registeredLayoutCommands(registeredLayoutIds(entries));
    expect(added.map((c) => c.id)).toEqual(['layout.arrange.screen.test:ring', 'layout.arrange.selection.test:ring']);
    // they run the layout command with the plugin's name, from the select tool's idle state
    const t = setup();
    t.session.selection.set([t.a, t.c]);
    const ctx = { ...t.ctx, tools: { ...t.ctx.tools, current: 'select.idle' } } as unknown as EditorCommandCtx;
    for (const c of added) expect(c.run(ctx)).toBe(true);
    expect(t.calls.map((c) => (c.args as { algorithm: string; scope: string }).algorithm)).toEqual(['test:ring', 'test:ring']);
    expect(t.calls.map((c) => (c.args as { scope: string }).scope)).toEqual(['screen', 'selection']);
    // the menus list them after the built-in lines
    const all = [...EDITOR_COMMANDS, ...added];
    expect(
      menuItems('screen', all)
        .map((i) => i.title)
        .at(-1),
    ).toBe('Arrange the screen (test:ring)');
    expect(menuItems('element', all).map((i) => i.title)).toContain('Arrange the selection (test:ring)');
    expect(menuItems('canvas', all).map((i) => i.command)).not.toContain('layout.arrange.screen.test:ring');
  });
});

describe('Fit with hand-placed shapes (FR-LAY-012, M17.31)', () => {
  /** `t`'s core with the rect `id` placed by hand (or locked in place) at `box`. */
  function pin(
    t: ReturnType<typeof setup>,
    id: RecordId,
    box: { x: number; y: number },
    { how = 'pinned', name }: { how?: 'pinned' | 'locked'; name?: string } = {},
  ) {
    const extra = how === 'pinned' ? { placement: 'pinned' } : { locks: { position: true } };
    t.core.store.transact('pin', (tx) => tx.patch(id, { transform: { ...box, w: 100, h: 50 }, ...extra, ...(name ? { name } : {}) } as never));
  }

  it('FR-LAY-012: WHEN a dragged shape partly off the screen is fitted THE SYSTEM SHALL say it was left in place, naming it', () => {
    const t = setup();
    t.core.execute('element.ungroup', { ids: [t.group] });
    pin(t, t.a, { x: 950, y: 100 }, { name: 'Logo' });
    expect(fitToScreen(t.ctx)).toBe(true);
    expect(t.calls).toEqual([{ id: 'layout.arrange', args: { screenId: t.screen, scope: 'screen', algorithm: 'fit' } }]);
    expect(t.notices).toEqual(['Left in place, outside the safe area: "Logo" (it is pinned or locked, so Fit does not move it).']);
  });

  it('FR-LAY-012: a locked shape in the margin counts; a pinned shape inside the safe area, a hidden one outside, or a refused fit say nothing', () => {
    const t = setup();
    t.core.execute('element.ungroup', { ids: [t.group] });
    // the safe area of a 1000 x 600 screen is inset 30 px: x 30..970, y 30..570
    pin(t, t.a, { x: 10, y: 100 }, { how: 'locked' });
    expect(fitToScreen(t.ctx)).toBe(true);
    expect(t.notices).toEqual(['Left in place, outside the safe area: a shape (it is pinned or locked, so Fit does not move it).']);
    const inside = setup();
    inside.core.execute('element.ungroup', { ids: [inside.group] });
    pin(inside, inside.a, { x: 100, y: 100 });
    inside.core.store.transact('off', (tx) => tx.patch(inside.c, { transform: { x: 990, y: 300, w: 100, h: 50 } } as never));
    // a hidden shape is not laid out, so it is not named
    inside.core.store.transact('hide', (tx) => tx.patch(inside.c, { hidden: true, placement: 'pinned' } as never));
    expect(fitToScreen(inside.ctx)).toBe(true);
    expect(fitToScreen(setup(false).ctx)).toBe(false);
    expect([...inside.notices]).toEqual([]);
  });

  it('FR-LAY-012: the notice judges against the safe area the fit layout uses (one safeAreaOf, M17 final F6)', () => {
    const t = setup();
    t.core.execute('element.ungroup', { ids: [t.group] });
    const area = safeAreaOf(screenFrame(t.core.store.get(t.screen)));
    expect(area).toEqual({ x: 30, y: 30, w: 940, h: 540 });
    // flush with the safe area's right edge: inside, no notice
    pin(t, t.a, { x: area.x + area.w - 100, y: 100 });
    expect(fitToScreen(t.ctx)).toBe(true);
    expect(t.notices).toEqual([]);
    // one pixel past it: named
    pin(t, t.a, { x: area.x + area.w - 99, y: 100 }, { name: 'Edge' });
    expect(fitToScreen(t.ctx)).toBe(true);
    expect(t.notices).toEqual(['Left in place, outside the safe area: "Edge" (it is pinned or locked, so Fit does not move it).']);
  });

  it('FR-LAY-012: with a background runner the notice replaces "Arranging…" once the fit is done', async () => {
    const t = setup(true, () => Promise.resolve({ ok: true }));
    t.core.execute('element.ungroup', { ids: [t.group] });
    for (const [i, id] of [t.a, t.c].entries()) pin(t, id, { x: 980, y: 100 + i * 60 }, { name: `S${i}` });
    expect(fitToScreen(t.ctx)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.notices).toEqual(['Arranging…', 'Left in place, outside the safe area: "S0", "S1" (they are pinned or locked, so Fit does not move them).']);
  });
});
