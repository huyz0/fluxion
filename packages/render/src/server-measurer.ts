// Measuring text where there is no canvas (FR-TXT-002, ADR-0148, M10.33): the CLI, the MCP server and layout workers add up the recorded metrics of
// the faces they know, as the browser does once a document's fonts have loaded, and measure any other font at a fixed advance, so the same document
// gets the same line widths wherever it is measured. Pure: no canvas, no DOM.
import { createMetricsMeasurer, type FaceMetrics, type FontSpec, type TextMeasurer, type TextMetrics } from '@fluxion/core';

/**
 * The advance, in em, of every character of a font nobody recorded: a typical sans-serif average, so a line is neither much too wide nor much too
 * narrow.
 *
 * @public
 */
export const FIXED_ADVANCE_EM: number = 0.6;

/**
 * A measurer with fixed metrics: every character is `advance` em wide, lines are the font's line height (1.2 when omitted) tall, ascent 0.8 em and
 * descent 0.2 em, the numbers the canvas measurer and the recorded-metrics measurer answer for height.
 *
 * @public
 */
export function createFixedMeasurer(advance: number = FIXED_ADVANCE_EM): TextMeasurer {
  return {
    measure(text: string, font: FontSpec): TextMetrics {
      const lines = text.split('\n');
      return {
        width: Math.max(...lines.map((line) => [...line].length)) * advance * font.size,
        height: lines.length * (font.lineHeight ?? 1.2) * font.size,
        ascent: 0.8 * font.size,
        descent: 0.2 * font.size,
      };
    },
  };
}

/**
 * The measurer of a host without a canvas: the recorded metrics of `faces`, and the fixed advance for a font none of them covers.
 *
 * @public
 */
export function serverMeasurer(faces: readonly FaceMetrics[]): TextMeasurer {
  return createMetricsMeasurer(faces, createFixedMeasurer());
}
