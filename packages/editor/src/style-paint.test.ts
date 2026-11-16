// FR-ARR-007: Copy style and Paste style (M19.40). Copy style takes the one selected element as the source; Paste style gives the
// selection its style through `element.pasteStyle`, style only (never `semantic`), in one undo step; the element menu offers each
// line only where it acts.
import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { copyStyle, offersStyleLine, pasteStyle } from './style-paint.js';
import type { ToolCtx } from './tools.js';

function setup() {
  const b = documentBuilder({ seed: 41 });
  const s = b.screen();
  const rects = [0, 1, 2].map((k) => b.rect(s, { x: k * 200, y: 0, w: 100, h: 100 })) as RecordId[];
  const core = createCore(b.build());
  const [a, c, d] = rects as [RecordId, RecordId, RecordId];
  core.execute('element.update', { id: a, fields: { style: { fill: '{color.accent}', opacity: 0.5 } } } as never);
  core.execute('element.update', { id: d, fields: { semantic: { label: 'Kept' } } } as never);
  core.store.history.seal();
  const session = createSession('doc');
  const ctx = { session, view: core.store, execute: (id: string, args: unknown) => core.execute(id, args as never) } as unknown as ToolCtx;
  return { core, a, c, d, session, ctx };
}

const styleOf = (ctx: ToolCtx, id: RecordId) => (ctx.view.get(id) as { style?: unknown }).style;

describe('copy style and paste style (FR-ARR-007)', () => {
  it('FR-ARR-007: Paste style gives every selected element the copied style, tokens as written, in one undo step', () => {
    const { core, a, c, d, session, ctx } = setup();
    session.selection.set([a]);
    expect(copyStyle(ctx)).toBe(true);
    session.selection.set([c, d]);
    expect(pasteStyle(ctx)).toBe(true);
    for (const id of [c, d]) expect(styleOf(ctx, id)).toEqual({ fill: '{color.accent}', opacity: 0.5 });
    // style only: the semantic stays
    expect((ctx.view.get(d) as { semantic?: unknown }).semantic).toEqual({ label: 'Kept' });
    core.store.history.seal();
    core.store.history.undo();
    for (const id of [c, d]) expect(styleOf(ctx, id)).toBeUndefined();
    expect(styleOf(ctx, a)).toEqual({ fill: '{color.accent}', opacity: 0.5 });
  });

  it('FR-ARR-007: Copy style needs exactly one element; Paste style needs a copied style and another element', () => {
    const { a, c, session, ctx } = setup();
    expect(pasteStyle(ctx)).toBe(false);
    session.selection.set([a, c]);
    expect(copyStyle(ctx)).toBe(false);
    session.selection.set([a]);
    expect(copyStyle(ctx)).toBe(true);
    // the source alone takes nothing
    expect(pasteStyle(ctx)).toBe(false);
  });

  it('FR-ARR-007: the element menu offers Copy style for one element and Paste style once a style is copied', () => {
    const { a, c, session, ctx } = setup();
    session.selection.set([a, c]);
    expect([offersStyleLine(ctx, 'selection.copyStyle'), offersStyleLine(ctx, 'selection.pasteStyle')]).toEqual([false, false]);
    session.selection.set([a]);
    expect([offersStyleLine(ctx, 'selection.copyStyle'), offersStyleLine(ctx, 'selection.pasteStyle')]).toEqual([true, false]);
    copyStyle(ctx);
    session.selection.set([c]);
    expect([offersStyleLine(ctx, 'selection.copyStyle'), offersStyleLine(ctx, 'selection.pasteStyle')]).toEqual([true, true]);
    // other lines are not this rule's
    expect(offersStyleLine(ctx, 'selection.group')).toBe(true);
  });
});
