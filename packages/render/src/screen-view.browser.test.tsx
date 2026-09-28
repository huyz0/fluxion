import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderMode } from './mode-policy.js';
import { ScreenView } from './screen-view.js';

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

/** A document with one screen of `size`, and a store over it. */
function setup(size?: { w: number; h: number }) {
  const b = documentBuilder({ seed: 400 });
  const screenId = b.screen(size ? { size } : {});
  return { core: createCore(b.build()), screenId };
}

async function show(props: {
  mode?: RenderMode;
  box: { w: number; h: number };
  screenId: RecordId;
  store: ReturnType<typeof createCore>['store'];
  overlay?: boolean;
}) {
  await act(async () =>
    root.render(
      <ScreenView
        store={props.store}
        screenId={props.screenId}
        mode={props.mode ?? 'present'}
        view={{ kind: 'fit', box: props.box }}
        editOverlay={props.overlay ? <svg data-testid="overlay" /> : undefined}
      />,
    ),
  );
  return host.querySelector<HTMLElement>('.fx-screen');
}

describe('<ScreenView> (FR-SCR-001, 04 §2)', () => {
  it('FR-SCR-001: a 1920x1080 screen fits a 960x540 box at scale 0.5', async () => {
    const { core, screenId } = setup();
    const screen = await show({ store: core.store, screenId, box: { w: 960, h: 540 } });
    expect(screen).not.toBeNull();
    const rect = (screen as HTMLElement).getBoundingClientRect();
    expect(rect.width).toBeCloseTo(960, 3);
    expect(rect.height).toBeCloseTo(540, 3);
    const view = host.querySelector<HTMLElement>('.fx-view')?.getBoundingClientRect();
    expect(rect.left - (view?.left ?? 0)).toBeCloseTo(0, 3);
    expect(getComputedStyle(screen as HTMLElement).transform).toBe('matrix(0.5, 0, 0, 0.5, 0, 0)');
    // the logical size stays 1920x1080: content is laid out in screen pixels
    expect((screen as HTMLElement).offsetWidth).toBe(1920);
    expect((screen as HTMLElement).dataset['screenId']).toBe(screenId);
  });

  it('FR-SCR-001: a screen of another ratio is letterboxed and centred', async () => {
    const { core, screenId } = setup({ w: 800, h: 800 });
    const screen = (await show({ store: core.store, screenId, box: { w: 400, h: 200 } })) as HTMLElement;
    const rect = screen.getBoundingClientRect();
    const view = host.querySelector<HTMLElement>('.fx-view')?.getBoundingClientRect() as DOMRect;
    expect([rect.width, rect.height]).toEqual([200, 200]);
    expect(rect.left - view.left).toBeCloseTo(100, 3);
  });

  it('the theme variables sit on the screen, the content CSS is injected once, the overlay only in edit', async () => {
    const { core, screenId } = setup();
    const screen = (await show({ store: core.store, screenId, box: { w: 960, h: 540 }, overlay: true, mode: 'present' })) as HTMLElement;
    expect(screen.style.getPropertyValue('--fx-color-primary')).toBe('#2563eb');
    expect(host.querySelector('[data-testid="overlay"]')).toBeNull();
    expect(screen.hasAttribute('data-interactive')).toBe(true);
    await show({ store: core.store, screenId, box: { w: 960, h: 540 }, overlay: true, mode: 'edit' });
    expect(host.querySelector('.fx-overlay [data-testid="overlay"]')).not.toBeNull();
    expect(host.querySelector('.fx-screen')?.hasAttribute('data-interactive')).toBe(false);
    expect(document.querySelectorAll('style[data-fx-content]')).toHaveLength(1);
    // a layer stack: background, content, overlay
    expect([...(host.querySelector('.fx-screen')?.children ?? [])].map((c) => c.className)).toEqual([
      'fx-layer fx-background',
      'fx-layer fx-content',
      'fx-layer fx-overlay',
    ]);
  });

  it('re-renders when the screen record changes; renders nothing for a missing screen', async () => {
    const { core, screenId } = setup();
    await show({ store: core.store, screenId, box: { w: 960, h: 540 } });
    await act(async () => {
      core.execute('screen.reorder', { id: screenId });
      core.store.transact('resize', (tx) => tx.patch(screenId, { size: { w: 960, h: 540 } }));
    });
    expect(getComputedStyle(host.querySelector('.fx-screen') as HTMLElement).transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await show({ store: core.store, screenId: 'MissingMissing01' as RecordId, box: { w: 10, h: 10 } });
    expect(host.querySelector('.fx-screen')).toBeNull();
  });
});
