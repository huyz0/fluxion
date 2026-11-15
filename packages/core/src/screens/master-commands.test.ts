import { type DocumentFile, type RecordId, type ScreenRecord, screenSize } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';
import { appliedMaster, placeholdersOf } from '../masters.js';
import { nextVisibleScreen } from './screen-order.js';

type Rec = { readonly [field: string]: unknown };

/** A master `brand` (a `title` placeholder and a logo), `a` and `b` using it, an ordinary `other` of another size, and an infinite screen. */
function setup() {
  const b = documentBuilder({ seed: 1923 });
  const brand = b.screen({ name: 'Brand' });
  const title = b.rect(brand, { x: 100, y: 200, w: 800, h: 100 });
  const logo = b.rect(brand, { x: 20, y: 20, w: 100, h: 40 });
  const a = b.screen();
  const fillA = b.rect(a, { x: 110, y: 210, w: 700, h: 80 });
  const own = b.rect(a, { x: 0, y: 0, w: 10, h: 10 });
  const s2 = b.screen();
  const fillB = b.rect(s2, { x: 110, y: 210, w: 700, h: 80 });
  const other = b.screen({ size: { w: 800, h: 600 } });
  const endless = b.screen({ kind: 'infinite', viewport: { x: 0, y: 0, w: 1920, h: 1080 } });
  const file = b.build();
  const fields: Record<string, object> = {
    [brand]: { role: 'master' },
    [title]: { placeholder: 'title', style: { fill: '#ff0000' } },
    [a]: { masterId: brand },
    [s2]: { masterId: brand },
    [fillA]: { fills: title },
    [fillB]: { fills: title },
  };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const core = createCore({ ...file, records } as unknown as DocumentFile);
  const get = (id: string) => core.store.get(id as RecordId) as unknown as Rec;
  return { core, get, brand, title, logo, a, s2, fillA, fillB, own, other, endless };
}

const refusal = (r: { ok: boolean; error?: { message: string } }) => (r.ok ? undefined : r.error?.message);

describe('master commands (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: screen.setRole makes an ordinary screen a master in one undo step, and refuses a screen with a master or an infinite one', () => {
    const t = setup();
    expect(t.core.execute('screen.setRole', { id: t.other, master: true }).ok).toBe(true);
    expect(t.get(t.other)['role']).toBe('master');
    expect(t.core.store.history.undo().ok).toBe(true);
    expect(t.get(t.other)['role']).toBeUndefined();
    expect(refusal(t.core.execute('screen.setRole', { id: t.a, master: true }))).toMatch(/masters apply one level only/);
    expect(refusal(t.core.execute('screen.setRole', { id: t.endless, master: true }))).toMatch(/infinite/);
  });

  it('FR-SCR-005: an ordinary screen again, a master leaves its screens without a master and clears their fills, undone as one step', () => {
    const t = setup();
    const depth = t.core.store.history.undoDepth;
    expect(t.core.execute('screen.setRole', { id: t.brand, master: false }).ok).toBe(true);
    expect(t.core.store.history.undoDepth).toBe(depth + 1);
    expect([t.get(t.brand)['role'], t.get(t.a)['masterId'], t.get(t.s2)['masterId']]).toEqual([undefined, undefined, undefined]);
    expect([t.get(t.fillA)['fills'], t.get(t.fillB)['fills']]).toEqual([undefined, undefined]);
    t.core.store.history.undo();
    expect([t.get(t.brand)['role'], t.get(t.a)['masterId'], t.get(t.fillA)['fills']]).toEqual(['master', t.brand, t.title]);
  });

  it('FR-SCR-005: screen.setMaster gives a screen the master and its size; refuses an ordinary target, a master and an infinite screen', () => {
    const t = setup();
    expect(t.core.execute('screen.setMaster', { id: t.other, masterId: t.brand }).ok).toBe(true);
    expect(t.get(t.other)['size']).toEqual(screenSize(t.get(t.brand) as unknown as ScreenRecord));
    expect(appliedMaster(t.core.store, t.other as RecordId)).toEqual({ master: t.brand });
    expect(refusal(t.core.execute('screen.setMaster', { id: t.a, masterId: t.other }))).toMatch(/not a master/);
    expect(refusal(t.core.execute('screen.setMaster', { id: t.brand, masterId: t.brand }))).toMatch(/one level only/);
    expect(refusal(t.core.execute('screen.setMaster', { id: t.endless, masterId: t.brand }))).toMatch(/infinite/);
  });

  it('FR-SCR-005: taking a screen’s master away clears its own fills only; the other screens keep theirs', () => {
    const t = setup();
    expect(t.core.execute('screen.setMaster', { id: t.a }).ok).toBe(true);
    expect([t.get(t.a)['masterId'], t.get(t.fillA)['fills'], t.get(t.fillB)['fills']]).toEqual([undefined, undefined, t.title]);
    // the screen keeps its size and its own elements
    expect(t.get(t.own)['screenId']).toBe(t.a);
  });

  it('FR-SCR-005: element.setPlaceholder names a master element a placeholder, refuses one of an ordinary screen, and unnaming clears its fillers', () => {
    const t = setup();
    expect(t.core.execute('element.setPlaceholder', { id: t.logo, name: 'logo' }).ok).toBe(true);
    expect(placeholdersOf(t.core.store, t.brand as RecordId)).toEqual(expect.arrayContaining([t.title, t.logo]));
    expect(refusal(t.core.execute('element.setPlaceholder', { id: t.own, name: 'x' }))).toMatch(/master screen/);
    expect(t.core.execute('element.setPlaceholder', { id: t.title }).ok).toBe(true);
    expect([t.get(t.title)['placeholder'], t.get(t.fillA)['fills'], t.get(t.fillB)['fills']]).toEqual([undefined, undefined, undefined]);
  });

  it('FR-SCR-005: element.setPlaceholder refuses a group, whose members a fill would not copy', () => {
    const t = setup();
    const groupId = 'GroupGroupGroupG' as RecordId;
    expect(t.core.execute('element.group', { ids: [t.logo], groupId }).ok).toBe(true);
    expect(refusal(t.core.execute('element.setPlaceholder', { id: groupId, name: 'brand' }))).toMatch(/group or frame/);
    expect(t.get(groupId)['placeholder']).toBeUndefined();
  });

  it('FR-SCR-005: element.fillPlaceholder refuses a group placeholder that came in another way (a loaded file)', () => {
    const b = documentBuilder({ seed: 1945 });
    const brand = b.screen();
    const logo = b.rect(brand, { x: 0, y: 0, w: 10, h: 10 });
    const s = b.screen();
    const file = b.build();
    const groupId = 'GroupGroupGroupG' as RecordId;
    const group = { ...(file.records[logo] as object), id: groupId, kind: 'group', placeholder: 'brand' };
    const records = {
      ...file.records,
      [brand]: { ...(file.records[brand] as object), role: 'master' },
      [s]: { ...(file.records[s] as object), masterId: brand },
      [logo]: { ...(file.records[logo] as object), parentId: groupId },
      [groupId]: group,
    };
    const core = createCore({ ...file, records } as unknown as DocumentFile);
    const r = core.execute('element.fillPlaceholder', { screenId: s, placeholderId: groupId, newId: 'FilledFilledFill' });
    expect(refusal(r)).toMatch(/group or frame/);
  });

  it('FR-SCR-005: element.fillPlaceholder puts a copy of the placeholder on the screen, on top, filling it; refuses a second fill and a non-placeholder', () => {
    const t = setup();
    expect(t.core.execute('element.setPlaceholder', { id: t.logo, name: 'logo' }).ok).toBe(true);
    expect(t.core.execute('element.fillPlaceholder', { screenId: t.a, placeholderId: t.logo, newId: 'FillLogoFillLogo' }).ok).toBe(true);
    const copy = t.get('FillLogoFillLogo');
    const logo = t.get(t.logo);
    expect(copy).toMatchObject({ screenId: t.a, fills: t.logo, kind: logo['kind'], transform: logo['transform'] });
    expect(copy['placeholder']).toBeUndefined();
    const tops = [t.fillA, t.own].map((x) => String(t.get(x)['index']));
    expect(tops.every((i) => i < String(copy['index']))).toBe(true);
    expect(refusal(t.core.execute('element.fillPlaceholder', { screenId: t.a, placeholderId: t.title, newId: 'FillTitleFillTit' }))).toMatch(
      /filled on this screen already/,
    );
    expect(refusal(t.core.execute('element.fillPlaceholder', { screenId: t.other, placeholderId: t.title, newId: 'FillTitleFillTit' }))).toMatch(
      /not a placeholder/,
    );
  });

  it('FR-SCR-005: presentation order skips a master: the next screen after one made a master is the screen beyond it', () => {
    const t = setup();
    // in order: brand (a master), a, s2, other
    expect(nextVisibleScreen(t.core.store, t.a, -1)).toBeUndefined();
    expect(t.core.execute('screen.setRole', { id: t.other, master: true }).ok).toBe(true);
    expect(nextVisibleScreen(t.core.store, t.s2)).toBe(t.endless);
    // from a master itself, the next presented screen
    expect(nextVisibleScreen(t.core.store, t.brand)).toBe(t.a);
  });
});
