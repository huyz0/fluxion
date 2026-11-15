import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { menuItems } from './context-menu-model.js';
import { EDITOR_COMMANDS } from './editor-commands.js';
import { clearPlaceholder, closeMaster, fillAt, makePlaceholder, openMaster } from './master-edit.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

type Rec = { readonly [field: string]: unknown };

/** A master `brand` with a logo and a named title box, a screen `a` using it, and an ordinary screen `plain`. */
function setup() {
  const b = documentBuilder({ seed: 1924 });
  const brand = b.screen({ name: 'Brand' });
  const logo = b.rect(brand, { x: 20, y: 20, w: 100, h: 40 });
  const title = b.rect(brand, { x: 100, y: 200, w: 800, h: 100 });
  const a = b.screen();
  const plain = b.screen();
  const box = b.rect(plain, { x: 0, y: 0, w: 10, h: 10 });
  const file = b.build();
  const fields: Record<string, object> = { [brand]: { role: 'master' }, [a]: { masterId: brand }, [title]: { name: 'Title' } };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const core = createCore({ ...file, records } as unknown as DocumentFile);
  const session = createSession('doc');
  const ctxOn = (screen: RecordId): ToolCtx => ({
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => 'FilledFilledFill' as RecordId,
    hitTest: () => undefined,
    elementsIn: () => [],
    screen,
    allElements: () => [],
  });
  const get = (id: string) => core.store.get(id as RecordId) as unknown as Rec;
  return { core, session, ctxOn, get, brand, logo, title, a, plain, box };
}

describe('master editing on the canvas (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: the one selected element of a master becomes a placeholder named by its name, and an ordinary element again', () => {
    const t = setup();
    const ctx = t.ctxOn(t.brand);
    t.session.selection.set([t.title]);
    expect(makePlaceholder(ctx)).toBe(true);
    expect(t.get(t.title)['placeholder']).toBe('Title');
    // a placeholder already, it is not named again
    expect(makePlaceholder(ctx)).toBe(false);
    t.session.selection.set([t.logo]);
    expect(makePlaceholder(ctx)).toBe(true);
    expect(t.get(t.logo)['placeholder']).toBe('Placeholder');
    expect(clearPlaceholder(ctx)).toBe(true);
    expect(t.get(t.logo)['placeholder']).toBeUndefined();
    expect(clearPlaceholder(ctx)).toBe(false);
    // an element of an ordinary screen is none
    t.session.selection.set([t.box]);
    expect(makePlaceholder(t.ctxOn(t.plain))).toBe(false);
  });

  it('FR-SCR-005: a double-click inside an unfilled placeholder hint fills it with the selected copy; outside one, or filled, nothing', () => {
    const t = setup();
    t.session.selection.set([t.title]);
    expect(makePlaceholder(t.ctxOn(t.brand))).toBe(true);
    const ctx = t.ctxOn(t.a);
    expect(fillAt(ctx, { x: 50, y: 50 })).toBe(false);
    expect(fillAt(ctx, { x: 500, y: 250 })).toBe(true);
    expect(t.get('FilledFilledFill')).toMatchObject({ screenId: t.a, fills: t.title });
    expect(t.session.selection.get()).toEqual(['FilledFilledFill']);
    // filled now: no hint is left there
    expect(fillAt(ctx, { x: 500, y: 250 })).toBe(false);
    expect(fillAt(t.ctxOn(t.plain), { x: 500, y: 250 })).toBe(false);
  });

  it('FR-SCR-005: Edit master shows the shown screen’s master, Close master goes back to a screen using it; elsewhere both do nothing', () => {
    const t = setup();
    expect(openMaster(t.ctxOn(t.a))).toBe(true);
    expect(t.session.screen.get()).toBe(t.brand);
    expect(openMaster(t.ctxOn(t.brand))).toBe(false);
    expect(closeMaster(t.ctxOn(t.brand))).toBe(true);
    expect(t.session.screen.get()).toBe(t.a);
    expect(openMaster(t.ctxOn(t.plain))).toBe(false);
    expect(closeMaster(t.ctxOn(t.plain))).toBe(false);
  });

  it('FR-SCR-005: the element menu offers the placeholder lines and the screen menu Edit master and Close master', () => {
    const element = menuItems('element', EDITOR_COMMANDS).map((i) => i.command);
    expect(element).toEqual(expect.arrayContaining(['master.makePlaceholder', 'master.clearPlaceholder']));
    expect(menuItems('screen', EDITOR_COMMANDS).map((i) => i.command)).toEqual(expect.arrayContaining(['master.edit', 'master.close']));
  });
});
