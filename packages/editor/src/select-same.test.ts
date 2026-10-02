import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { selectSame } from './select-same.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

function setup() {
  const b = documentBuilder({ seed: 77 });
  const s = b.screen();
  const rects = [0, 1, 2].map((k) => b.rect(s, { x: k * 200, y: 0, w: 100, h: 100 }));
  const text = b.text(s, 'hello', { x: 0, y: 300, w: 100, h: 40 });
  const core = createCore(b.build());
  // two of the rectangles share a style, written with its keys in different orders
  core.execute('element.update', { id: rects[0], fields: { style: { fill: '#f00', opacity: 0.5 } } } as never);
  core.execute('element.update', { id: rects[1], fields: { style: { opacity: 0.5, fill: '#f00' } } } as never);
  const session = createSession('doc');
  const ctx = { session, view: core.store, allElements: () => [...core.store.members('byScreen', s)] } as unknown as ToolCtx;
  return { core, rects: rects as RecordId[], text, session, ctx };
}

describe('select same (FR-EDT-004)', () => {
  it('FR-EDT-004: select same type selects every element of the shown screen of the first selected one`s type', () => {
    const { rects, text, session, ctx } = setup();
    session.selection.set([rects[2] as RecordId]);
    expect(selectSame(ctx, 'type')).toBe(true);
    expect([...session.selection.get()].sort()).toEqual([...rects].sort());
    session.selection.set([text]);
    expect(selectSame(ctx, 'type')).toBe(true);
    expect(session.selection.get()).toEqual([text]);
  });

  it('FR-EDT-004: select same style selects the elements of that kind with an equal style, key order aside', () => {
    const { rects, session, ctx } = setup();
    session.selection.set([rects[1] as RecordId]);
    expect(selectSame(ctx, 'style')).toBe(true);
    expect([...session.selection.get()].sort()).toEqual([rects[0], rects[1]].sort());
    // the unstyled one is alone with itself
    session.selection.set([rects[2] as RecordId]);
    selectSame(ctx, 'style');
    expect(session.selection.get()).toEqual([rects[2]]);
  });

  it('FR-EDT-004: with nothing selected, or an element that is gone, nothing is done', () => {
    const { session, ctx } = setup();
    expect(selectSame(ctx, 'type')).toBe(false);
    session.selection.set(['GoneGoneGoneGone' as RecordId]);
    expect(selectSame(ctx, 'style')).toBe(false);
    expect(selectSame(ctx, 'color' as never)).toBe(false);
    expect(session.selection.get()).toEqual(['GoneGoneGoneGone']);
  });
});
