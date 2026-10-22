// FR-LAY-001 (M17.17): the layout options form in a real browser: a number option shows its default, and editing it re-runs the layout.
import { type AnyCommand, createCore, defineCommand } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { LayoutOptionsSection } from './layout-options-form.js';
import { createSession } from './session.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const stackSchema = { type: 'object', properties: { gap: { type: 'number', minimum: 0, default: 24 }, wrap: { type: 'boolean', default: false } } };

/** A stand-in `layout.arrange` (the editor does not depend on the layouts): the second shape goes `gap` below the first, as a stack would place it. */
function stackBy(first: RecordId, second: RecordId): AnyCommand {
  const args = { safeParse: (value: unknown) => ({ success: true as const, data: value as { options?: { gap?: number } } }) };
  return defineCommand({
    id: 'layout.arrange',
    title: { id: 'test.arrange', defaultMessage: 'Arrange' },
    args,
    run: (ctx, a) => {
      const top = (ctx.store.get(first) as unknown as { transform: { x: number; y: number; h: number } }).transform;
      const y = top.y + top.h + (a.options?.gap ?? 24);
      return ctx.store.transact('layout.arrange', (tx) => tx.patch(second, { transform: { x: top.x, y, w: 100, h: 50 } }), ctx.options);
    },
  }) as unknown as AnyCommand;
}

/** A group of two shapes laid out as a stack, selected, with its options form. */
async function open() {
  const b = documentBuilder({ seed: 1717 });
  const screen = b.screen({ size: { w: 800, h: 600 } });
  const a = b.rect(screen, { x: 10, y: 10, w: 100, h: 50 });
  const c = b.rect(screen, { x: 300, y: 200, w: 100, h: 50 });
  const core = createCore(b.build());
  const group = 'GroupLayout00001' as RecordId;
  expect(core.execute('element.group', { ids: [a, c], groupId: group }).ok).toBe(true);
  expect(core.execute('element.update', { id: group, fields: { layout: { type: 'stack' } } }).ok).toBe(true);
  core.execute('element.update', { id: c, fields: { transform: { x: 300, y: 200, w: 100, h: 50 } } });
  core.registries.commands.register('layout.arrange', stackBy(a, c), 'core');
  core.store.history.seal();
  const calls: Array<{ id: string; args: unknown; options: unknown }> = [];
  const execute = ((id: string, args: unknown, options?: never) => {
    calls.push({ id, args, options });
    return core.execute(id, args, options);
  }) as typeof core.execute;
  const session = createSession('l');
  session.selection.set([group]);
  const schemaOf = (layout: { readonly type: string }) => (layout.type === 'stack' ? stackSchema : undefined);
  await act(async () => root.render(<LayoutOptionsSection store={core.store} session={session} execute={execute} screenId={screen} schemaOf={schemaOf} />));
  await act(frame);
  return { core, session, group, screen, calls, second: c };
}

const input = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const yOf = (core: ReturnType<typeof createCore>, id: RecordId) => (core.store.get(id) as unknown as { transform: { y: number } }).transform.y;
const layoutOf = (core: ReturnType<typeof createCore>, id: RecordId) => (core.store.get(id) as unknown as { layout?: unknown }).layout;

describe('the layout options form (FR-LAY-001)', { timeout: 60_000 }, () => {
  it('FR-LAY-001: a number option shows a field with its default; editing it re-runs the layout', async () => {
    const { core, group, screen, calls, second } = await open();
    expect(host.querySelector('legend')?.textContent).toContain('stack');
    expect(input('gap').value).toBe('24');
    await userEvent.click(input('gap'));
    input('gap').select();
    await userEvent.keyboard('40{Enter}');
    await act(frame);
    expect(calls.map((c) => c.id)).toEqual(['element.update', 'layout.arrange']);
    expect(calls[1]).toEqual({
      id: 'layout.arrange',
      args: { screenId: screen, scope: { containerId: group }, algorithm: 'stack', options: { gap: 40 } },
      options: { amend: true },
    });
    expect(layoutOf(core, group)).toEqual({ type: 'stack', options: { gap: 40 } });
    // the layout ran with the new gap: the second shape is 40 below the first (10 + 50 + 40)
    expect(yOf(core, second)).toBe(100);
    expect(input('gap').value).toBe('40');
    // one undo takes back the option and the move together
    core.store.history.undo();
    await act(frame);
    expect(layoutOf(core, group)).toEqual({ type: 'stack' });
    expect(yOf(core, second)).toBe(200);
    expect(input('gap').value).toBe('24');
  });

  it('FR-LAY-001: an entry out of bounds is given back, a toggle is set at once, and nothing shows without a layout', async () => {
    const { core, session, group, calls } = await open();
    await userEvent.click(input('gap'));
    input('gap').select();
    await userEvent.keyboard('-5{Enter}');
    await act(frame);
    expect(calls).toEqual([]);
    expect(input('gap').value).toBe('24');
    await userEvent.click(input('wrap'));
    await act(frame);
    expect(layoutOf(core, group)).toEqual({ type: 'stack', options: { wrap: true } });
    await act(async () => session.selection.set([]));
    await act(frame);
    expect(host.querySelector('fieldset')).toBeNull();
  });
});
