import { createMetricsMeasurer, readFontMetrics, type StyledBlock, type TextMeasurer, wrapStyled } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { styledBlocks } from './rich-layout.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the recorded font metrics, the rich documents, and the height a browser drew each one (scripts/fonts/record-metrics.mjs)
const FILES = import.meta.glob('../../../fixtures/fonts/*.json', { query: '?raw', import: 'default', eager: true });
const json = (name: string): unknown => JSON.parse(FILES[`../../../fixtures/fonts/${name}`] ?? 'null');
const docs = (json('rich-samples.json') as { readonly samples: readonly { readonly name: string; readonly doc: RichTextDoc }[] }).samples;
const recorded = (json('roboto.rendered.json') as { readonly rich: readonly { readonly name: string; readonly width: number; readonly height: number }[] })
  .rich;
// a font with no recorded metrics (the monospace of inline code): a character is 0.6 em wide, which the heights do not depend on
const charFallback: TextMeasurer = { measure: (text, font) => ({ width: [...text].length * 0.6 * font.size, height: 0, ascent: 0, descent: 0 }) };
const measurer = createMetricsMeasurer(readFontMetrics(json('roboto.metrics.json')).faces, charFallback);
const base = { family: 'Roboto', size: 16, lineHeight: 1.2, weight: 400 };
const blocksOf = (name: string): StyledBlock[] => styledBlocks(docs.find((d) => d.name === name)?.doc, LIGHT_THEME);

describe('a fit measures the text as it is drawn (FR-TXT-002, FR-SHP-006)', () => {
  it('FR-TXT-002: a fit measures marks and blocks as they are drawn', () => {
    // not vacuous: every sample has a recorded height, and the set covers runs, headings, lists and spacing
    expect(recorded.map((r) => r.name).sort()).toEqual(docs.map((d) => d.name).sort());
    expect(recorded.length).toBeGreaterThanOrEqual(10);
    const errors = recorded.map((r) => {
      const laid = wrapStyled(blocksOf(r.name), base, measurer, { maxWidth: r.width, spacing: 'add' });
      return { name: r.name, error: Math.abs(laid.height - r.height) };
    });
    const worst = errors.reduce((a, b) => (b.error > a.error ? b : a));
    expect(worst.error, `height of ${worst.name}`).toBeLessThanOrEqual(1);
    // the plain lines the old fit measured are off by far more on the same samples: the test can fail
    const flat = recorded.map((r) => {
      const lines = blocksOf(r.name)
        .flatMap((b) => b.runs.map((run) => run.text).join(''))
        .filter((l) => l !== '');
      return Math.abs(
        wrapStyled(
          lines.map((text) => ({ runs: [{ text }] })),
          base,
          measurer,
          { maxWidth: r.width },
        ).height - r.height,
      );
    });
    expect(Math.max(...flat)).toBeGreaterThan(10);
  });

  it('FR-TXT-002: a size mark makes its line taller, a heading is bigger, and a block`s spacing and indent count', () => {
    const height = (blocks: readonly StyledBlock[], width: number) => wrapStyled(blocks, base, measurer, { maxWidth: width }).height;
    const width = (name: string) => recorded.find((r) => r.name === name)?.width ?? 0;
    // the same text without its size run, heading scale and spacing is shorter
    const noSize = blocksOf('size-run').map((b) => ({ ...b, runs: b.runs.map((r) => ({ text: r.text })) }));
    expect(height(blocksOf('size-run'), width('size-run'))).toBeGreaterThan(height(noSize, width('size-run')) + 10);
    const noScale = blocksOf('heading-1').map((b) => ({ ...b, scale: 1 }));
    expect(height(blocksOf('heading-1'), width('heading-1'))).toBeGreaterThan(height(noScale, width('heading-1')) + 20);
    const noSpace = blocksOf('spacing').map((b) => ({ ...b, before: 0, after: 0 }));
    expect(height(blocksOf('spacing'), width('spacing'))).toBeCloseTo(height(noSpace, width('spacing')) + 10 + 20 + 4, 6);
    // a list item sits inside its list: 1.5 em per level
    expect(blocksOf('list').map((b) => b.indentEm)).toEqual([1.5, 3, 3, 1.5]);
  });
});
