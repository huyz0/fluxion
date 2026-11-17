// FR-THM-006 end to end (ADR-0055, cp2 F4): `tone:` written in FluxScript or in a patch, compiled, then drawn by the view with
// the theme's style for the element's kind and variant.
import { createCore, createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { compile, patchDocument } from '@fluxion/dsl';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { renderRegistriesFor } from '@fluxion/player';
import { ScreenView } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** `basic:rect` as packs/basic defines it. */
const RECT: ShapeDef = { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } };
const registries = (() => {
  const r = createCoreRegistries();
  r.shapeDefs.register(RECT.id, RECT, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();

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

const SOURCE = 'flux: 1\ntitle: Tones\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      plain: { shape: rect, label: Plain }\n';

/** The compiled document of `source`. */
function compiled(source: string): DocumentFile {
  const r = compile(source, { registries });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.doc as DocumentFile;
}

/** Draw the first screen of `doc` and give each shape's outline and label style by its label text. */
async function drawn(doc: DocumentFile) {
  const core = createCore(doc);
  const screenId = core.store.members('byType', 'screen')[0] as RecordId;
  await act(async () =>
    root.render(
      <ScreenView
        registries={renderRegistriesFor(registries)}
        store={core.store}
        screenId={screenId}
        mode="present"
        view={{ kind: 'fit', box: { w: 1200, h: 800 } }}
      />,
    ),
  );
  const byLabel = (text: string) => {
    const el = [...host.querySelectorAll('.fx-el')].find((e) => e.querySelector('.fx-label')?.textContent === text) as Element;
    const outline = getComputedStyle(el.querySelector('path.fx-outline') as Element);
    const label = getComputedStyle(el.querySelector('.fx-label') as Element);
    return { fill: outline.fill, strokeWidth: outline.strokeWidth, color: label.color, weight: label.fontWeight };
  };
  return byLabel;
}

// the light theme's emphasis for a shape: secondary (#7c3aed) at the thick stroke, bold text on the background colour
const EMPHASIS = { fill: 'rgb(124, 58, 237)', strokeWidth: '4px', color: 'rgb(255, 255, 255)', weight: '700' };
const PLAIN = { fill: 'rgb(248, 250, 252)', strokeWidth: '2px', color: 'rgb(15, 23, 42)', weight: '400' };

describe('tone: in FluxScript and patches (FR-THM-006)', () => {
  it('FR-THM-006: variant emphasis set through FluxScript renders the themed style', async () => {
    const doc = compiled(`${SOURCE}      loud: { shape: rect, label: Loud, tone: emphasis }\n`);
    // the compiler writes the tone as the shape's style variant, the field the theme resolves
    const variants = Object.values(doc.records)
      .map((r) => (r as { style?: { variant?: string } }).style?.variant)
      .filter(Boolean);
    expect(variants).toEqual(['emphasis']);
    const style = await drawn(doc);
    expect(style('Loud')).toEqual(EMPHASIS);
    expect(style('Plain')).toEqual(PLAIN);
  });

  it('FR-THM-006: variant emphasis set through a patch renders the themed style', async () => {
    const patched = patchDocument(
      compiled(SOURCE),
      { flux: 1, ops: [{ op: 'add', screen: 'main', slug: 'loud', node: { shape: 'rect', label: 'Loud', tone: 'emphasis' } }] },
      registries,
    );
    expect(patched.ok).toBe(true);
    const style = await drawn((patched as { document: DocumentFile }).document);
    expect(style('Loud')).toEqual(EMPHASIS);
    expect(style('Plain')).toEqual(PLAIN);
  });
});
