// FR-EDT-022: compiling a 10-screen FluxScript file (18 nodes, 17 chain edges and 2 labelled cross edges per screen, a layout on every
// screen and a note on every other) stays fast enough to run on every keystroke of the source view; the M12 gate's bench leg holds the
// p99 of `compile-10` to DSL_COMPILE_10_MAX_MS. The shapes are stand-ins with the packs' ids and sizes: packages/dsl may not import a
// pack (check-layering), and the pack shape defs only add outline paths, which compile never reads. The text is generated here with
// unique ids, in the shape of examples/dsl/order-flowchart.flux.yaml; strict mode and default options are what the editor runs.
import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, test } from 'vitest';
import { compile } from '../src/compile.js';

const SCREENS = 10;
const NODES = 18;
const SHAPES = ['rect', 'rounded-rect', 'ellipse', 'diamond', 'document', 'parallelogram'] as const;
const LAYOUTS = ['{ type: stack, direction: down, gap: 32, align: center }', '{ type: stack, direction: right, gap: 48, align: center }'];

function registries() {
  const r = createCoreRegistries();
  for (const name of SHAPES) {
    const id = `basic:${name}`;
    r.shapeDefs.register(id, { id, defaultSize: { w: 160, h: 80 } } as unknown as ShapeDef, 'basic');
  }
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

/** One screen's source: `NODES` nodes chained by edges, plus two labelled cross edges. */
function screen(s: number): string[] {
  const lines = [`  - id: screen-${s}`, `    title: Screen ${s}`, `    layout: ${LAYOUTS[s % 2]}`, '    nodes:'];
  for (let n = 0; n < NODES; n++) {
    const tone = n % 5 === 0 ? ', tone: accent' : '';
    lines.push(`      s${s}n${n}: { shape: ${SHAPES[(s + n) % SHAPES.length]}, label: Step ${n} of screen ${s}${tone} }`);
  }
  lines.push('    edges:');
  for (let n = 1; n < NODES; n++) lines.push(`      - s${s}n${n - 1} -> s${s}n${n}${n % 4 === 0 ? `: step ${n}` : ''}`);
  lines.push(`      - s${s}n2.s -> s${s}n9.n: yes`, `      - s${s}n5.e -> s${s}n14.w: { label: no, route: orthogonal }`);
  if (s % 2 === 0) lines.push('    notes: |', `      Screen ${s} of the generated bench file.`);
  return lines;
}

/** The generated source: `SCREENS` screens. */
function source(): string {
  const head = ['flux: 1', 'title: Ten screens', 'theme: light', 'uses: [basic]', 'screens:'];
  return `${[...head, ...Array.from({ length: SCREENS }, (_, s) => screen(s)).flat()].join('\n')}\n`;
}

describe('compile (FR-EDT-022)', () => {
  test('FR-EDT-022: compile-10', async ({ bench }) => {
    const text = source();
    const reg = registries();
    const first = compile(text, { registries: reg });
    const errors = first.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning');
    if (!first.doc || errors.length) throw new Error(`the bench source does not compile cleanly: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}`);
    await bench('compile-10', { async: false }, () => {
      compile(text, { registries: reg });
    }).run({ time: 3_000, warmupTime: 500 });
  });
});
