import { createCore } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
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

/** A screen holding a container of `kind` at (100, 100) 200 × 100 with one rect overflowing it. */
async function show(kind: 'group' | 'frame', fields: Record<string, unknown> = {}) {
  const b = documentBuilder({ seed: 175 });
  const screen = b.screen({ size: { w: 400, h: 300 } });
  const file = b.build();
  const container = 'ContainerContain' as RecordId;
  const member = 'MemberMemberMemb' as RecordId;
  const records = {
    ...file.records,
    [container]: { id: container, type: 'element', screenId: screen, kind, index: 'a0', transform: { x: 100, y: 100, w: 200, h: 100 }, ...fields },
    [member]: {
      id: member,
      type: 'element',
      screenId: screen,
      parentId: container,
      kind: 'placeholder:x',
      index: 'a0',
      transform: { x: 250, y: 150, w: 100, h: 20 },
    },
  } as unknown as Record<string, AnyRecord>;
  const core = createCore({ ...file, records });
  await act(async () =>
    root.render(
      <ScreenView store={core.store} screenId={screen} mode="present" view={{ kind: 'fit', box: { w: 400, h: 300 } }} registries={builtinRegistries()} />,
    ),
  );
  const wrapper = host.querySelector<HTMLElement>(`.fx-el[data-el-id="${container}"]`) as HTMLElement;
  const drawn = host.querySelector<HTMLElement>(`.fx-el[data-el-id="${member}"]`) as HTMLElement;
  return { wrapper, drawn };
}

describe('container views (FR-EDT-003, FR-EDT-010)', () => {
  it('FR-EDT-010: a group draws its members and no box or placeholder of its own', async () => {
    const { wrapper, drawn } = await show('group');
    expect(wrapper.querySelector(':scope > svg')).toBeNull();
    expect(wrapper.querySelector(':scope > .fx-placeholder')).toBeNull();
    expect(wrapper.contains(drawn)).toBe(true);
    const screen = host.querySelector('.fx-screen')?.getBoundingClientRect();
    expect(Math.round(drawn.getBoundingClientRect().left - (screen?.left ?? 0))).toBe(250);
  });

  it('FR-EDT-010: a frame draws its box in its style and clips its members to it, unless clip is false', async () => {
    const framed = await show('frame');
    const rect = framed.wrapper.querySelector(':scope > svg > rect') as SVGRectElement;
    expect([rect.getAttribute('width'), rect.getAttribute('height'), rect.style.fill, rect.style.strokeWidth]).toEqual([
      '200',
      '100',
      'var(--fx-color-surface)',
      '0px',
    ]);
    const clip = framed.drawn.closest('.fx-members')?.parentElement as HTMLElement;
    expect([clip.parentElement === framed.wrapper, getComputedStyle(clip).overflow]).toEqual([true, 'hidden']);
    expect(clip.getBoundingClientRect().width).toBeCloseTo(framed.wrapper.getBoundingClientRect().width, 3);
    // its own style: a gradient is not drawn yet (none), the stroke is
    const styled = await show('frame', {
      clip: false,
      style: {
        fill: {
          type: 'linear-gradient',
          angle: 0,
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#ffffff' },
          ],
        },
        stroke: { color: '#ff0000', width: 2 },
      },
    });
    const own = styled.wrapper.querySelector(':scope > svg > rect') as SVGRectElement;
    expect([own.style.fill, own.style.stroke]).toEqual(['none', 'rgb(255, 0, 0)']);
    expect(styled.drawn.closest('.fx-members')?.parentElement).toBe(styled.wrapper);
  });
});
