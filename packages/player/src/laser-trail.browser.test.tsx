import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LASER_FADE } from './laser-keys.js';
import { LaserTrail } from './laser-trail.js';

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

describe('laser trail (FR-EDT-003)', () => {
  it('FR-EDT-003: the trail draws a dot per point, kept on screen at any scale, each fading on its own', async () => {
    await act(async () => root.render(<LaserTrail points={[]} scale={2} />));
    expect(host.innerHTML).toBe('');
    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 20 },
    ];
    await act(async () => root.render(<LaserTrail points={points} scale={2} />));
    const svg = host.querySelector('svg.fx-laser') as SVGSVGElement;
    expect([svg.getAttribute('aria-hidden'), svg.style.pointerEvents, svg.style.position]).toEqual(['true', 'none', 'absolute']);
    const dots = [...svg.querySelectorAll('circle')];
    // 5 px on screen: 2.5 page units at twice the size
    expect(dots.map((d) => [d.getAttribute('cx'), d.getAttribute('cy'), d.getAttribute('r')])).toEqual([
      ['10', '20', '2.5'],
      ['30', '40', '2.5'],
      ['10', '20', '2.5'],
    ]);
    const style = (dots[0] as SVGCircleElement).style;
    expect([style.animationName, style.animationDuration, style.animationFillMode, style.animationTimingFunction]).toEqual([
      'fx-laser-fade',
      LASER_FADE,
      'forwards',
      'linear',
    ]);
    expect(LASER_FADE).toBe('0.8s');
    // a dot that stays in the trail keeps its node, so its fade runs once from when it appeared
    const first = dots[1];
    await act(async () => root.render(<LaserTrail points={[...points.slice(1), { x: 50, y: 60 }]} scale={2} />));
    expect(host.querySelectorAll('circle')[0]).toBe(first);
  });

  it('FR-EDT-003: a dot added long after the trail appeared is drawn, and fades within LASER_FADE of appearing', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const opacity = (i: number) => Number(getComputedStyle(host.querySelectorAll('circle')[i] as Element).opacity);
    const a = { x: 10, y: 10 };
    const b = { x: 20, y: 20 };
    await act(async () => root.render(<LaserTrail points={[a]} scale={1} />));
    // longer than LASER_FADE: the first dot has faded
    await wait(1100);
    expect(opacity(0)).toBeLessThan(0.05);
    await act(async () => root.render(<LaserTrail points={[a, b]} scale={1} />));
    // the new dot has its own animation, started when it appeared (not 1100 ms ago, when the trail did). It is paused and set to a time,
    // so the check does not depend on how long a slow runner takes between two timers.
    const fade = (host.querySelectorAll('circle')[1] as Element).getAnimations()[0];
    expect(fade).toBeDefined();
    fade?.pause();
    expect(Number(fade?.currentTime)).toBeLessThan(500);
    if (fade) fade.currentTime = 100;
    expect(opacity(1)).toBeGreaterThan(0.5);
    if (fade) fade.currentTime = 1100;
    expect(opacity(1)).toBeLessThan(0.05);
  });
});
