import { createCore, effect } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { jumpToMatch } from './find-bar.js';
import { findMatches, keyIds, matchKey, searchableText, stepMatch } from './find-model.js';
import { createSession } from './session.js';

const SECTION = 'SectionSectionSe' as RecordId;

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Two screens: `one` with a "Login" box below a box labelled "login form", `two` with a box whose text says "Logout" and another named "Login button". */
function setup(sectioned = false) {
  const b = documentBuilder({ seed: 1925 });
  const one = b.screen();
  const two = b.screen();
  const lower = b.rect(one, { x: 0, y: 300, w: 100, h: 40 });
  const upper = b.rect(one, { x: 400, y: 20, w: 100, h: 40 });
  const other = b.rect(one, { x: 0, y: 100, w: 100, h: 40 });
  const logout = b.rect(two, { x: 0, y: 0, w: 100, h: 40 });
  const named = b.rect(two, { x: 0, y: 200, w: 100, h: 40 });
  const file = b.build();
  const fields: Record<string, object> = {
    [lower]: { text: doc('Login') },
    [upper]: { semantic: { label: 'login form' } },
    [other]: { text: doc('Help') },
    [logout]: { text: doc('Logout') },
    [named]: { name: 'Login button' },
  };
  // screen one in a section: the navigator lists it after two, which is in none
  if (sectioned) fields[one] = { sectionId: SECTION };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const sections = sectioned ? { [SECTION]: { id: SECTION, type: 'section', name: 'Later', index: 'a0' } } : {};
  const core = createCore({ ...file, records: { ...records, ...sections } } as unknown as DocumentFile);
  return { core, one, two, lower, upper, other, logout, named };
}

describe('element search (FR-EDT-016)', () => {
  it('FR-EDT-016: a query finds elements by text, name and semantic label, ignoring case, screen by screen in reading order', () => {
    const { core, one, two, lower, upper, named } = setup();
    expect(findMatches(core.store, 'LOGIN')).toEqual([
      { id: upper, screen: one },
      { id: lower, screen: one },
      { id: named, screen: two },
    ]);
    expect(findMatches(core.store, 'log').map((m) => m.id)).toHaveLength(4);
  });

  it('FR-EDT-016: screens are searched in navigator order: those in no section before a section’s', () => {
    const { core, one, two } = setup(true);
    expect(findMatches(core.store, 'login').map((m) => m.screen)).toEqual([two, one, one]);
  });

  it('FR-EDT-016: what draws the matches is not told of an edit that leaves them as they were (a drag re-renders no more)', () => {
    const { core, one, lower, upper, other } = setup();
    const key = core.store.query((view) => matchKey(view, 'login', one));
    let runs = 0;
    const stop = effect(() => {
      key();
      runs += 1;
    });
    expect(keyIds(key())).toEqual([upper, lower]);
    // the Help box moves, as a drag frame would move it: the matches are the same
    core.store.transact('move', (tx) => tx.patch(other, { transform: { x: 50, y: 100, w: 100, h: 40 } }));
    expect(runs).toBe(1);
    // it now says Login: the matches change
    core.store.transact('text', (tx) => tx.patch(other, { text: doc('Login too') }));
    expect(runs).toBe(2);
    expect(keyIds(key())).toEqual([upper, other, lower]);
    stop();
  });

  it('FR-EDT-016: a blank query or one nothing holds finds nothing', () => {
    const { core } = setup();
    expect(findMatches(core.store, '   ')).toEqual([]);
    expect(findMatches(core.store, 'zebra')).toEqual([]);
  });

  it('FR-EDT-016: text regions and table cells are searched too', () => {
    expect(searchableText({ texts: { title: doc('Quarterly') } as never, cells: { '0:0': { text: doc('Revenue') } } as never })).toEqual([
      'Quarterly',
      'Revenue',
    ]);
  });

  it('FR-EDT-016: the next match wraps; from none it starts on the shown screen; previous goes back', () => {
    const m = [
      { id: 'a' as RecordId, screen: 's1' as RecordId },
      { id: 'b' as RecordId, screen: 's2' as RecordId },
      { id: 'c' as RecordId, screen: 's2' as RecordId },
    ];
    expect(stepMatch(m, 'c' as RecordId, 1)?.id).toBe('a');
    expect(stepMatch(m, 'a' as RecordId, -1)?.id).toBe('c');
    expect(stepMatch(m, undefined, 1, 's2' as RecordId)?.id).toBe('b');
    expect(stepMatch(m, undefined, -1, 's2' as RecordId)?.id).toBe('a');
    expect(stepMatch([], undefined, 1)).toBeUndefined();
  });

  it('FR-EDT-016: Enter jumps to the next match across screens and selects it', () => {
    const { core, one, two, lower, upper, named } = setup();
    const session = createSession('doc');
    session.screen.set(one);
    session.find.set({ query: 'login', opened: 1 });
    expect(jumpToMatch(core.store, session, 1)).toBe(true);
    expect(session.selection.get()).toEqual([upper]);
    jumpToMatch(core.store, session, 1);
    expect(session.selection.get()).toEqual([lower]);
    jumpToMatch(core.store, session, 1);
    expect(session.screen.get()).toBe(two);
    expect(session.selection.get()).toEqual([named]);
    expect(session.find.get()?.current).toBe(named);
    session.find.set({ query: 'zebra', opened: 1 });
    expect(jumpToMatch(core.store, session, 1)).toBe(false);
  });
});
