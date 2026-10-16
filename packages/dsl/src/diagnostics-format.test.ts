import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { formatDiagnostics } from './diagnostics/format.js';

function registries() {
  const r = createCoreRegistries();
  for (const id of ['basic:rect', 'basic:rounded-rect', 'flowchart:database']) r.shapeDefs.register(id, { id } as unknown as ShapeDef, id.split(':')[0] ?? id);
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

const head = 'flux: 1\ntitle: T\nuses: [basic]\nscreens:\n  - id: a\n    nodes:\n';
// ten broken FluxScript files, each broken in a different way (FR-AI-004)
const BROKEN: { readonly [name: string]: string } = {
  'no version': 'title: T\nscreens: []\n',
  'wrong version': 'flux: 2\ntitle: T\nscreens: []\n',
  'bad yaml': 'flux: 1\ntitle: [unclosed\n',
  'unknown shape': `${head}      x: { shape: rectt }\n`,
  'duplicate slug': `${head}      x: { shape: rect }\n      x: { shape: rect }\n`,
  'bad slug': `${head}      "Bad Slug!": { shape: rect }\n`,
  'unknown key': `${head}      x: { shape: rect, colour: red }\n`,
  'missing edge target': `${head}      x: { shape: rect }\n    edges:\n      - x -> nowhere\n`,
  'bad edge syntax': `${head}      x: { shape: rect }\n    edges:\n      - x => x\n`,
  'negative size': `${head}      x: { shape: rect, pin: { x: 0, y: 0, w: -5, h: 10 } }\n`,
};

const formatted = (text: string) => formatDiagnostics(compile(text, { registries: registries() }).diagnostics);

describe('the diagnostic formatter for models (FR-AI-004)', () => {
  it.each(Object.keys(BROKEN))('FR-AI-004: %s — every error line carries a hint', (name) => {
    const lines = formatted(BROKEN[name] as string);
    expect(lines.some((l) => l.includes(' error '))).toBe(true);
    for (const line of lines.filter((l) => l.includes(' error '))) expect(line, line).toContain('— hint: ');
  });

  it('FR-AI-004: the formatted output of ten broken files is stable', () => {
    expect(Object.fromEntries(Object.entries(BROKEN).map(([name, text]) => [name, formatted(text)]))).toMatchSnapshot();
  });
});
