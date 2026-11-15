import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from './bootstrap.js';
import { appliedMaster, dependentsOf, isMasterScreen, masterLayers, placeholdersOf, sameMasterLayers, sharedPlaceholderNames, strayFills } from './masters.js';

const red = '#ff0000';
const blue = '#0000ff';

/**
 * A master (red background, a logo and a `title` placeholder) and screens using it: `plain`, `own` (its own background, filling
 * the title), `bare` (hideMasterElements); and the screens whose master does not apply: to an ordinary screen, through a chain,
 * of another size, and infinite.
 */
function setup() {
  const b = documentBuilder({ seed: 1922 });
  const master = b.screen({ name: 'Brand' });
  const logo = b.rect(master, { x: 20, y: 20, w: 100, h: 40 });
  const title = b.rect(master, { x: 100, y: 200, w: 800, h: 100 });
  const plain = b.screen();
  const own = b.screen();
  const filler = b.rect(own, { x: 120, y: 210, w: 700, h: 80 });
  const bare = b.screen();
  const ordinary = b.screen();
  const toOrdinary = b.screen();
  const second = b.screen();
  const chained = b.screen();
  const small = b.screen({ size: { w: 800, h: 600 } });
  const endless = b.screen({ kind: 'infinite', viewport: { x: 0, y: 0, w: 1920, h: 1080 } });
  const stray = b.rect(plain, { x: 0, y: 0, w: 10, h: 10 });
  const file = b.build();
  const fields: Record<string, object> = {
    [master]: { role: 'master', background: red },
    [title]: { placeholder: 'title' },
    [plain]: { masterId: master },
    [own]: { masterId: master, background: blue },
    [filler]: { fills: title },
    [bare]: { masterId: master, hideMasterElements: true },
    [toOrdinary]: { masterId: ordinary },
    [second]: { role: 'master', masterId: master },
    [chained]: { masterId: second },
    [small]: { masterId: master },
    [endless]: { masterId: master },
    // fills an element that is no placeholder of the master
    [stray]: { fills: logo },
  };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const core = createCore({ ...file, records } as unknown as DocumentFile);
  return { core, master, logo, title, plain, own, filler, bare, ordinary, toOrdinary, second, chained, small, endless, stray };
}

describe('master screens (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: a master applies to a fixed screen of its size; none for a non-master target, a chain, a size mismatch or an infinite screen, each with its problem', () => {
    const t = setup();
    const view = t.core.store;
    expect(appliedMaster(view, t.plain)).toEqual({ master: t.master });
    expect(appliedMaster(view, t.toOrdinary)).toEqual({ problem: 'not-master' });
    expect(appliedMaster(view, t.chained)).toEqual({ problem: 'chain' });
    // a master naming a master draws none itself either
    expect(appliedMaster(view, t.second)).toEqual({ problem: 'chain' });
    expect(appliedMaster(view, t.small)).toEqual({ problem: 'size' });
    expect(appliedMaster(view, t.endless)).toEqual({ problem: 'infinite' });
    expect(appliedMaster(view, t.ordinary)).toEqual({});
    expect(appliedMaster(view, 'missing' as RecordId)).toEqual({});
    for (const id of [t.toOrdinary, t.chained, t.small, t.endless]) expect(masterLayers(view, id)).toBeUndefined();
    expect([isMasterScreen(view.get(t.master)), isMasterScreen(view.get(t.plain)), isMasterScreen(undefined)]).toEqual([true, false, false]);
  });

  it('FR-SCR-005: the screen draws the master’s background unless it has its own, its elements but not its placeholders, and an unfilled placeholder as a hint', () => {
    const t = setup();
    const view = t.core.store;
    expect(placeholdersOf(view, t.master)).toEqual([t.title]);
    expect(masterLayers(view, t.plain)).toEqual({ master: t.master, background: red, elements: true, placeholders: new Set([t.title]), unfilled: [t.title] });
    // the screen's own background wins; a filled placeholder is no hint
    expect(masterLayers(view, t.own)).toMatchObject({ background: blue, elements: true, unfilled: [] });
    // hideMasterElements hides the elements and the hints, not the background
    expect(masterLayers(view, t.bare)).toMatchObject({ background: red, elements: false, unfilled: [] });
  });

  it('FR-SCR-005: a `fills` naming no placeholder of the applied master draws as an ordinary element, and is reported', () => {
    const t = setup();
    const view = t.core.store;
    expect(strayFills(view, t.plain)).toEqual([t.stray]);
    expect(strayFills(view, t.own)).toEqual([]);
    // two placeholders sharing a name are reported, and each stays fillable by its id
    t.core.store.transact('edit', (tx) => tx.patch(t.logo, { placeholder: 'title' }));
    expect(sharedPlaceholderNames(view, t.master)).toEqual(new Map([['title', [t.logo, t.title].sort()]]));
    expect(strayFills(view, t.plain)).toEqual([]);
  });

  it('FR-SCR-005: a master change updates every dependent screen in the derived model', () => {
    const t = setup();
    expect(dependentsOf(t.core.store, t.master).sort()).toEqual([t.plain, t.own, t.bare].sort());
    const layers = [t.plain, t.bare].map((id) => t.core.store.query((view) => masterLayers(view, id)));
    expect(layers.map((q) => q()?.background)).toEqual([red, red]);
    expect(t.core.store.transact('edit', (tx) => tx.patch(t.master, { background: blue }))).toMatchObject({ ok: true });
    expect(layers.map((q) => q()?.background)).toEqual([blue, blue]);
    // the logo made a placeholder: on `plain`, the element that fills it now takes its place, and is no longer stray
    t.core.store.transact('edit', (tx) => tx.patch(t.logo, { placeholder: 'logo' }));
    expect(layers[0]?.()?.placeholders).toEqual(new Set([t.logo, t.title]));
    expect(layers[0]?.()?.unfilled).toEqual([t.title]);
    expect(strayFills(t.core.store, t.plain)).toEqual([]);
    // no longer a master: no screen depends on it
    t.core.store.transact('edit', (tx) => tx.patch(t.master, { role: undefined }));
    expect(dependentsOf(t.core.store, t.master)).toEqual([]);
    expect(layers.map((q) => q())).toEqual([undefined, undefined]);
  });

  it('FR-SCR-005: two layers that draw the same compare equal, whatever objects hold them', () => {
    const t = setup();
    const view = t.core.store;
    const a = masterLayers(view, t.plain);
    t.core.store.transact('move', (tx) => tx.patch(t.stray, { transform: { x: 5, y: 5, w: 10, h: 10 } }));
    const b = masterLayers(view, t.plain);
    expect(b).not.toBe(a);
    expect(sameMasterLayers(a, b)).toBe(true);
    expect(sameMasterLayers(a, masterLayers(view, t.own))).toBe(false);
    expect(sameMasterLayers(a, masterLayers(view, t.bare))).toBe(false);
    expect([sameMasterLayers(undefined, undefined), sameMasterLayers(a, undefined)]).toEqual([true, false]);
  });
});
