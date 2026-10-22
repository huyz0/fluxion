// The `fit` layout (FR-LAY-012): the boxes as they are, scaled down together and moved by the least amount that puts them inside the frame's safe
// area (the `fit` post-pass, `fitBoxes`), after overlapping boxes are pulled apart far enough that the gaps, scaled, stay at least the 1 px the
// pipeline's overlap pass keeps (else its nudges add up along a row and carry boxes out). It is what the editor's "Fit content to screen" and
// `layout.arrange` with `algorithm: 'fit'` run. It never scales up, content already inside the safe area does not move, and a pinned box (one
// placed by hand) stays where it is. Incremental: it starts from the boxes as placed, so the pipeline must not move it back toward an earlier
// layout.
import { z } from 'zod';
import { removeOverlap } from './overlap.js';
import { type Boxes, fitBoxes, fitScaleOf } from './passes.js';
import type { LayoutAlgorithm, LayoutInput, OptionsResult } from './types.js';

/**
 * Options of the `fit` layout.
 *
 * @public
 */
export type FitLayoutOptions = {
  /** The margin between the frame's edge and its safe area, px (default 5% of the frame's smaller side). */
  readonly margin?: number | undefined;
};

const schema = z.strictObject({ margin: z.number().finite().min(0).optional() }).default({});

/** The most rounds of separating with a wider margin before fitting: each widens the gaps to what the last scale needs. */
const ROUNDS = 8;

/** The boxes with overlaps removed, the gaps wide enough that after the fit's scale they are still at least 1 px. */
function separated(input: LayoutInput, o: FitLayoutOptions): Boxes {
  const placed = Object.fromEntries(input.nodes.map((n) => [n.id, n.box]));
  let margin = 1;
  let boxes = removeOverlap(input, placed, { margin });
  for (let round = 0; round < ROUNDS; round += 1) {
    const scale = fitScaleOf(input, boxes, o);
    if (margin * scale >= 1 + 1e-6) break;
    margin = Math.ceil(1 / scale) + 1;
    boxes = removeOverlap(input, placed, { margin });
  }
  return boxes;
}

/**
 * The `fit` layout: the boxes scaled down and moved into the frame's safe area.
 *
 * @public
 */
export const fitLayout: LayoutAlgorithm<FitLayoutOptions> = {
  id: 'fit',
  describe: 'Fit to screen: keeps the arrangement, scaling it down and moving it into the safe area inside the screen edge.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, incremental: true, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<FitLayoutOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `fit options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run: (input: LayoutInput, o: FitLayoutOptions) => ({ boxes: fitBoxes(input, separated(input, o), o) }),
};
