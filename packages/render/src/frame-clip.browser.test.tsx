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

const FRAME = 'FrameFrameFrame1' as RecordId;
const MEMBER = 'MemberMemberMemb' as RecordId;

/** A 400 × 300 screen shown at 100 %: frame F (with `frame`'s fields) holding a member at (250,150) 100 × 20. */
async function show(frame: Record<string, unknown>) {
  const b = documentBuilder({ seed: 1911 });
  const screen = b.screen({ size: { w: 400, h: 300 } });
  const file = b.build();
  const records = {
    ...file.records,
    [FRAME]: { id: FRAME, type: 'element', screenId: screen, kind: 'frame', index: 'a0', ...frame },
    [MEMBER]: {
      id: MEMBER,
      type: 'element',
      screenId: screen,
      parentId: FRAME,
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
  const origin = (host.querySelector('.fx-screen') as HTMLElement).getBoundingClientRect();
  const member = host.querySelector(`.fx-el[data-el-id="${MEMBER}"]`) as HTMLElement;
  // what the browser paints at screen point (x, y): the member, or not
  return (x: number, y: number) => member.contains(document.elementFromPoint(origin.left + x, origin.top + y));
}

describe('clipping frames when drawn (FR-ARR-006, ADR-0052)', () => {
  it('FR-ARR-006: a clipping frame hides a member outside its box; with clip false the overflow is drawn', async () => {
    const clipped = await show({ transform: { x: 100, y: 100, w: 200, h: 100 } });
    expect([clipped(280, 160), clipped(320, 160)]).toEqual([true, false]);
    const open = await show({ transform: { x: 100, y: 100, w: 200, h: 100 }, clip: false });
    expect([open(280, 160), open(320, 160)]).toEqual([true, true]);
  });

  it('FR-ARR-006: a turned frame clips to its turned box, its members still drawn where their screen coordinates put them', async () => {
    // turned 90° about (200, 150) the frame spans x 150..250, y 50..250: the member (250..350) is wholly outside
    const turned = await show({ transform: { x: 100, y: 100, w: 200, h: 100, rot: 90 } });
    expect([turned(260, 160), turned(320, 160)]).toEqual([false, false]);
    // turned about (300, 150) it spans x 250..350: the member is wholly shown, upright where it was
    const over = await show({ transform: { x: 200, y: 100, w: 200, h: 100, rot: 90 } });
    expect([over(260, 155), over(340, 165), over(320, 175)]).toEqual([true, true, false]);
  });
});
