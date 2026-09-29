import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useElementBox } from './use-box.js';

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

describe('element boxes (FR-EDT-001)', () => {
  it("FR-EDT-001: an element's box follows its size", async () => {
    const seen: { w: number; h: number }[] = [];
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const box = useElementBox(ref);
      seen.push(box);
      return <div ref={ref} id="probe" style={{ width: 120, height: 80 }} />;
    }
    await act(async () => root.render(<Probe />));
    expect(seen.at(-1)).toEqual({ w: 120, h: 80 });
    await act(async () => {
      (host.querySelector('#probe') as HTMLElement).style.width = '300px';
      await frame();
    });
    expect(seen.at(-1)).toEqual({ w: 300, h: 80 });
  });
});
