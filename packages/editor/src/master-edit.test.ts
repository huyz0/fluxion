import { createCore, masterLayers } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { menuItems } from './context-menu-model.js';
import { EDITOR_COMMANDS } from './editor-commands.js';
import { clearPlaceholder, closeMaster, fillAt, makePlaceholder, offersMasterLine, openMaster } from './master-edit.js';
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

  it('FR-SCR-005: Close master shows the screen Edit master was run from, else the first in navigator order using the master', () => {
    const t = setup();
    expect(t.core.execute('screen.setMaster', { id: t.plain, masterId: t.brand }).ok).toBe(true);
    // opened from the second screen using it: back there, not to the first
    expect(openMaster(t.ctxOn(t.plain))).toBe(true);
    expect(closeMaster(t.ctxOn(t.brand))).toBe(true);
    expect(t.session.screen.get()).toBe(t.plain);
    // that screen no longer uses the master: the first that does
    openMaster(t.ctxOn(t.plain));
    t.core.execute('screen.setMaster', { id: t.plain });
    closeMaster(t.ctxOn(t.brand));
    expect(t.session.screen.get()).toBe(t.a);
  });

  it('FR-SCR-005: Close master falls back to the first screen in navigator order using the master, not the lowest id', () => {
    const b = documentBuilder({ seed: 1948 });
    const brand = b.screen({ name: 'Brand' });
    const screens = [b.screen(), b.screen(), b.screen()];
    const file = b.build();
    const records = Object.fromEntries(
      Object.entries(file.records).map(([id, r]) => [
        id,
        { ...r, ...(id === brand ? { role: 'master' } : screens.includes(id as RecordId) ? { masterId: brand } : {}) },
      ]),
    );
    const core = createCore({ ...file, records } as unknown as DocumentFile);
    const session = createSession('doc');
    const on = (screen: RecordId): ToolCtx => ({ ...setup().ctxOn(screen), session, view: core.store, execute: core.execute, screen });
    // the lowest id goes into a section: the navigator lists it after the screens in none
    const [low, mid, high] = [...screens].sort() as [RecordId, RecordId, RecordId];
    const section = 'SectionSectionSe' as RecordId;
    expect(core.execute('section.create', { id: section, name: 'Later' }).ok).toBe(true);
    expect(core.execute('screen.setSection', { id: low, sectionId: section }).ok).toBe(true);
    // opened from `high`, which then drops the master: back to `mid`, first in navigator order (id order would pick `low`)
    openMaster(on(high));
    core.execute('screen.setMaster', { id: high });
    closeMaster(on(brand));
    expect(session.screen.get()).toBe(mid);
  });

  it('FR-SCR-005: a group named a placeholder in a loaded file shows no fill hint and is not filled', () => {
    const t = setup();
    const groupId = 'GroupGroupGroupG' as RecordId;
    expect(t.core.execute('element.group', { ids: [t.logo], groupId }).ok).toBe(true);
    // as a file could hold it: the command refuses naming a group, so written straight to the store
    t.core.store.transact('load', (tx) => tx.patch(groupId, { placeholder: 'brand' }));
    expect(masterLayers(t.core.store, t.a)?.unfilled ?? []).not.toContain(groupId);
    expect(fillAt(t.ctxOn(t.a), { x: 50, y: 40 })).toBe(false);
  });

  it('FR-SCR-005: the element menu offers the placeholder lines and the screen menu Edit master and Close master', () => {
    const element = menuItems('element', EDITOR_COMMANDS).map((i) => i.command);
    expect(element).toEqual(expect.arrayContaining(['master.makePlaceholder', 'master.clearPlaceholder']));
    expect(menuItems('screen', EDITOR_COMMANDS).map((i) => i.command)).toEqual(expect.arrayContaining(['master.edit', 'master.close']));
  });

  it('FR-SCR-005: a canvas menu offers each master line only where it acts; other lines always', () => {
    const t = setup();
    const offered = (screen: RecordId) =>
      ['master.makePlaceholder', 'master.clearPlaceholder', 'master.edit', 'master.close', 'clipboard.copy'].filter((c) =>
        offersMasterLine(t.ctxOn(screen), c),
      );
    // an ordinary screen: none of them
    t.session.selection.set([t.box]);
    expect(offered(t.plain)).toEqual(['clipboard.copy']);
    // a screen using a master: Edit master
    t.session.selection.set([]);
    expect(offered(t.a)).toEqual(['master.edit', 'clipboard.copy']);
    // the master, an element selected: Make placeholder, then Make ordinary element once it is one
    t.session.selection.set([t.title]);
    expect(offered(t.brand)).toEqual(['master.makePlaceholder', 'master.close', 'clipboard.copy']);
    makePlaceholder(t.ctxOn(t.brand));
    expect(offered(t.brand)).toEqual(['master.clearPlaceholder', 'master.close', 'clipboard.copy']);
  });
});
