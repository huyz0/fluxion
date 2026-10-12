import type { RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { followRemap } from './source-remap.js';

const id = (s: string): RecordId => s as RecordId;

describe('source view, session follows an id remap', () => {
  it('FR-EDT-022: the selection, hover, edited and entered elements and the shown screen keep their element under the new id', () => {
    const session = createSession('doc');
    session.selection.set([id('a'), id('b')]);
    session.hover.set(id('a'));
    session.editing.set(id('a'));
    session.entered.set(id('g'));
    session.screen.set(id('s'));
    followRemap(
      session,
      new Map([
        [id('a'), id('a2')],
        [id('g'), id('g2')],
        [id('s'), id('s2')],
      ]),
    );
    expect(session.selection.get()).toEqual([id('a2'), id('b')]);
    expect(session.hover.get()).toBe(id('a2'));
    expect(session.editing.get()).toBe(id('a2'));
    expect(session.entered.get()).toBe(id('g2'));
    expect(session.screen.get()).toBe(id('s2'));
  });

  it('FR-EDT-022: nothing that is not remapped is touched, the selection keeps its identity', () => {
    const session = createSession('doc');
    const selected = [id('b')];
    session.selection.set(selected);
    followRemap(session, new Map([[id('a'), id('a2')]]));
    expect(session.selection.get()).toBe(selected);
    expect(session.hover.get()).toBeUndefined();
    expect(session.screen.get()).toBeUndefined();
  });
});
