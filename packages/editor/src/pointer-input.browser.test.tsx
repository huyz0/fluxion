import { act, type ReactNode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Camera } from './camera.js';
import type { PointerInfo } from './pointer.js';
import { type PointerConsumer, usePointerInput } from './pointer-input.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 30px; top: 40px; width: 300px; height: 200px;';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function Probe(props: { readonly camera: Camera; readonly consumer: PointerConsumer }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInput(ref, () => props.camera, props.consumer);
  return <div ref={ref} data-testid="probe" style={{ width: '100%', height: '100%' }} />;
}

const fire = (el: Element, type: string, [x, y]: readonly [number, number], init: PointerEventInit = {}) => {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e.defaultPrevented;
};

describe('pointer input (FR-EDT-003)', () => {
  it('FR-EDT-003: events reach the consumer as canvas and page points, moves once per frame', async () => {
    const got: PointerInfo[] = [];
    let frames = 0;
    const consumer: PointerConsumer = {
      deliver: (i) => {
        got.push(i);
        return i.phase === 'down' ? true : undefined;
      },
      frameEnd: () => {
        frames += 1;
      },
    };
    await act(async () => root.render(<Probe camera={{ x: 10, y: 20, z: 2 }} consumer={consumer} />));
    const el = host.querySelector('[data-testid="probe"]') as HTMLElement;
    expect(fire(el, 'pointerdown', [50, 60], { shiftKey: true })).toBe(true);
    expect(got[0]).toMatchObject({ phase: 'down', screen: { x: 20, y: 20 }, page: { x: 20, y: 30 }, shift: true });
    fire(el, 'pointermove', [60, 60]);
    fire(el, 'pointermove', [70, 60]);
    expect(got.length).toBe(1);
    await act(frame);
    expect(got.map((g) => g.phase)).toEqual(['down', 'move']);
    // frameEnd ran before the down, and after the frame
    expect([got[1]?.screen.x, got[1]?.coalesced.length, frames]).toEqual([40, 2, 2]);
    expect(fire(el, 'pointerup', [70, 60])).toBe(false);
    fire(el, 'pointercancel', [70, 60]);
    expect(got.map((g) => g.phase)).toEqual(['down', 'move', 'up', 'cancel']);
  });

  it('FR-EDT-003: the latest consumer and camera are used, and unmounting stops the input', async () => {
    const a: string[] = [];
    const b: string[] = [];
    const as = (log: string[]): PointerConsumer => ({
      deliver: (i) => {
        log.push(`${i.phase}:${i.page.x}`);
        return undefined;
      },
    });
    await act(async () => root.render(<Probe camera={{ x: 0, y: 0, z: 1 }} consumer={as(a)} />));
    const el = host.querySelector('[data-testid="probe"]') as HTMLElement;
    fire(el, 'pointerdown', [40, 40]);
    await act(async () => root.render(<Probe camera={{ x: 100, y: 0, z: 1 }} consumer={as(b)} />));
    fire(el, 'pointermove', [40, 40]);
    fire(el, 'pointerup', [40, 40]);
    expect([a, b]).toEqual([['down:10'], ['move:110', 'up:110']]);
    act(() => root.unmount());
    root = createRoot(host);
    fire(el, 'pointerdown', [40, 40]);
    await act(frame);
    expect(b.length).toBe(2);
  });
});
