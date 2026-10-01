import { createMetricsMeasurer, readFontMetrics, type TextMeasurer } from '@fluxion/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanvasMeasurer } from './text-measurer.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FILES = import.meta.glob('../../../fixtures/fonts/*.json', { query: '?raw', import: 'default', eager: true });
const json = (name: string): unknown => JSON.parse(FILES[`../../../fixtures/fonts/${name}`] ?? 'null');
type Sample = { readonly text: string; readonly size: number; readonly weight: number; readonly width: number; readonly height: number };
const samples = (json('roboto.rendered.json') as { readonly samples: readonly Sample[] }).samples;

const loaded: FontFace[] = [];
beforeAll(async () => {
  for (const [file, weight] of [
    ['roboto-400.woff2', '400'],
    ['roboto-700.woff2', '700'],
  ] as const) {
    const face = new FontFace('Roboto', `url(${new URL(`../../../fixtures/fonts/${file}`, import.meta.url).href})`, { weight });
    document.fonts.add(await face.load());
    loaded.push(face);
  }
  await document.fonts.ready;
});
afterAll(() => {
  for (const face of loaded) document.fonts.delete(face);
});

/** What the DOM renders for `sample`: a span in the same font, as the editor and the player draw text. */
function rendered(sample: Sample, probe: HTMLElement): { readonly width: number; readonly height: number } {
  probe.style.font = `${sample.weight} ${sample.size}px/1.2 Roboto`;
  probe.textContent = sample.text;
  const box = probe.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

describe('measured text equals rendered text (FR-TXT-002, ADR-0148)', () => {
  it('FR-TXT-002: measured size equals rendered size ±1 px', async () => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;line-height:1.2';
    document.body.append(probe);
    try {
      const canvas = createCanvasMeasurer();
      await canvas.ready();
      const metrics = createMetricsMeasurer(readFontMetrics(json('roboto.metrics.json')).faces, canvas);
      // the canvas measurer is the fallback for a font with no recorded metrics: a canvas does not kern across a
      // space as the DOM does, so it is allowed two px (ADR-0148); the recorded metrics are the ±1 px ones
      const measurers: ReadonlyArray<readonly [string, TextMeasurer, number]> = [
        ['canvas', canvas, 2],
        ['metrics', metrics, 1],
      ];
      expect(samples.length).toBeGreaterThanOrEqual(40);
      const worst = { width: 0, height: 0, recorded: 0 };
      for (const s of samples) {
        const dom = rendered(s, probe);
        // what a browser renders now is what was recorded (the node test compares against the record)
        worst.recorded = Math.max(worst.recorded, Math.abs(dom.width - s.width), Math.abs(dom.height - s.height));
        for (const [name, measurer, allowed] of measurers) {
          const m = measurer.measure(s.text, { family: 'Roboto', size: s.size, weight: s.weight, lineHeight: 1.2 });
          const [dw, dh] = [Math.abs(m.width - dom.width), Math.abs(m.height - dom.height)];
          worst.width = Math.max(worst.width, dw);
          worst.height = Math.max(worst.height, dh);
          expect(dw, `${name} width of ${s.size}px/${s.weight} ${s.text.slice(0, 24)}`).toBeLessThanOrEqual(allowed);
          expect(dh, `${name} height of ${s.size}px/${s.weight} ${s.text.slice(0, 24)}`).toBeLessThanOrEqual(allowed);
        }
      }
      expect(worst.recorded).toBeLessThanOrEqual(1);
    } finally {
      probe.remove();
    }
  });

  it('FR-TXT-002: the DOM kerns across a space and the canvas does not, which is why the metrics are recorded from the DOM', () => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;font:400 100px/1.2 Roboto';
    document.body.append(probe);
    try {
      const dom = (text: string) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      };
      const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      context.font = '400 100px Roboto';
      const canvasAdjust = context.measureText(' T').width - context.measureText(' ').width - context.measureText('T').width;
      const domAdjust = dom(' T') - dom(' ') - dom('T');
      expect(domAdjust).toBeLessThan(-0.5);
      expect(Math.abs(canvasAdjust)).toBeLessThan(0.01);
      // the recorded table has that pair
      const face = readFontMetrics(json('roboto.metrics.json')).faces[0];
      expect(Math.abs((face?.pairs[' T'] ?? 0) / 10 - domAdjust)).toBeLessThan(0.2);
    } finally {
      probe.remove();
    }
  });
});
