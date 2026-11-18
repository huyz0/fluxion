import { createCore, type FontSpec, type TextMeasurer } from '@fluxion/core';
import { builtinRegistries } from '@fluxion/render';
import { ScreenSvgView, SvgSurface } from '@fluxion/render/svg';
import { documentBuilder } from '@fluxion/schema/testing';
import { resolveStyle } from '@fluxion/theme';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type ElementView, type ElementViewProps, ExportContext, useExportText } from './index.js';

/** Every character 20 px wide (wider than any default measurer's advance); ascent 8 and descent 2. */
const twenties: TextMeasurer = {
  measure: (text, font) => ({ width: [...text].length * 20, height: (font.lineHeight ?? 1.2) * font.size, ascent: 8, descent: 2 }),
};

/** A pack's badge: its words laid out by the export, one `<text>` per line at the layout's place. */
function BadgeSvg(props: ElementViewProps) {
  const { w, h } = (props.element as { transform: { w: number; h: number } }).transform;
  const { style } = resolveStyle(undefined, 'shape', props.theme, ['records', props.element.id, 'style']);
  const text = useExportText('alpha beta gamma', style, { w, h });
  return (
    <g>
      {text.lines.map((line) => (
        <text key={line.top} x={line.x} y={text.top + line.baseline} fill={text.color}>
          {line.text}
        </text>
      ))}
    </g>
  );
}

describe('@fluxion/sdk/export (ADR-0056 item 4, M20.42)', () => {
  it("FR-EXT-001 FR-EXP-004: a pack built against the subpath measures its text through the host's context and records its glyphs", () => {
    expect(ExportContext).toBe(SvgSurface);
    const b = documentBuilder({ seed: 2042 });
    const s = b.screen({ size: { w: 400, h: 200 } });
    const built = b.build();
    const records = {
      ...built.records,
      badge000000001: {
        id: 'badge000000001',
        type: 'element',
        screenId: s,
        index: 'z0',
        kind: 'acme:badge',
        props: {},
        transform: { x: 0, y: 0, w: 120, h: 80 },
      },
    };
    const { store } = createCore({ ...built, records } as unknown as typeof built);
    const registries = builtinRegistries();
    const view: ElementView = { Component: () => null, Svg: BadgeSvg };
    registries.elementViews.register('acme:badge', view, 'acme');
    const glyphs: string[] = [];
    const glyph = (font: FontSpec, text: string) => glyphs.push(`${font.size} ${text}`);
    const svg = renderToStaticMarkup(
      createElement(
        SvgSurface.Provider,
        { value: { measurer: twenties, glyphs: glyph } },
        createElement(ScreenSvgView, { store, screenId: s, mode: 'export', registries }),
      ),
    );
    // 120 px at 20 px a character holds one word a line (the fixed fallback's narrower advance would put two on the first)
    const lines = [...svg.matchAll(/<text x="[^"]+" y="[^"]+" fill="[^"]+">([^<]*)<\/text>/g)].map((m) => m[1]?.trim());
    expect(lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(glyphs.join('|')).toMatch(/alpha.*beta.*gamma/);
    expect(svg).not.toContain('FLX_EXPORT_NO_SVG_VIEW');
  });
});
