import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderMode } from './mode-policy.js';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

/** The built-in views and the basic rectangle (render ships no shape definitions: ADR-0016). */
const registries = testRegistries();

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
  camera?: { x: number; y: number; z: number };
}) {
  await act(async () =>
    root.render(
      <ScreenView
        registries={registries}
        store={props.store}
        screenId={props.screenId}
        mode={props.mode ?? 'present'}
        view={props.camera ? { kind: 'camera', box: props.box, camera: props.camera } : { kind: 'fit', box: props.box }}
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

  it('FR-EDT-002: a camera view draws the screen at the camera`s offset and zoom, clipped to its box', async () => {
    const { core, screenId } = setup();
    const screen = (await show({ store: core.store, screenId, box: { w: 600, h: 400 }, mode: 'edit', camera: { x: -100, y: 50, z: 0.25 } })) as HTMLElement;
    const view = host.querySelector<HTMLElement>('.fx-view') as HTMLElement;
    const rect = screen.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([600, 400]);
    expect([rect.left - box.left, rect.top - box.top, rect.width, rect.height]).toEqual([25, -12.5, 480, 270]);
    expect(getComputedStyle(view).overflow).toBe('hidden');
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

  it("FR-THM-004: a screen is drawn with its own theme, else the document's, else the light theme", async () => {
    const b = documentBuilder({ seed: 401 });
    const first = b.screen();
    const second = b.screen();
    const core = createCore(b.build());
    const paint = (name: string, color: string) => ({
      id: `theme-${name}`,
      type: 'theme' as const,
      name,
      tokens: { color: { primary: { $type: 'color', $value: color } } },
    });
    const primary = async (screenId: RecordId) => {
      await show({ store: core.store, screenId, box: { w: 960, h: 540 } });
      return getComputedStyle(host.querySelector('.fx-screen') as HTMLElement)
        .getPropertyValue('--fx-color-primary')
        .trim();
    };
    const light = await primary(first);
    // no theme record anywhere: the built-in light theme
    expect(light).toBe((LIGHT_THEME.tokens['color'] as unknown as { primary: { $value: string } }).primary.$value);
    await act(async () => {
      core.execute('document.setTheme', { theme: { name: 'doc', tokens: paint('doc', '#ff0000').tokens } });
      core.execute('screen.setThemeOverride', { id: second, theme: { name: 'own', tokens: paint('own', '#00ff00').tokens } });
    });
    expect(await primary(first)).toBe('#ff0000');
    expect(await primary(second)).toBe('#00ff00');
    await act(async () => {
      core.execute('screen.setThemeOverride', { id: second });
    });
    expect(await primary(second)).toBe('#ff0000');
  });

  it('FR-THM-004: a theme record that is not a theme is drawn as the light theme, not half styled', async () => {
    const b = documentBuilder({ seed: 402 });
    const screenId = b.screen();
    // an unchecked store holds the broken record a hand-edited file could carry
    const core = createCore(b.build(), { validate: false });
    const light = getComputedStyle(
      await (async () => (await show({ store: core.store, screenId, box: { w: 960, h: 540 } }), host.querySelector('.fx-screen') as HTMLElement))(),
    )
      .getPropertyValue('--fx-color-primary')
      .trim();
    await act(async () => {
      core.store.transact('break', (tx) => {
        tx.put({ id: 'theme-bad', type: 'theme', name: 'bad', tokens: 'nope' } as never);
        tx.patch(screenId, { themeId: 'theme-bad' });
      });
    });
    expect(
      getComputedStyle(host.querySelector('.fx-screen') as HTMLElement)
        .getPropertyValue('--fx-color-primary')
        .trim(),
    ).toBe(light);
  });
});
