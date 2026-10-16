// The layout rules (FR-AI-005): OVERLAP, OFFSCREEN, TEXT_OVERFLOW, DENSITY, ORPHAN_CONNECTOR. Each is pure over the document.
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { diagnostic } from '../patch/working-index.js';
import type { LintFinding, LintRule } from './types.js';
import { type Box, type Boxed, recordsOf, screensOf } from './view.js';

/** The share of the smaller box another element must cover to count as an overlap. */
const OVERLAP_MIN_SHARE = 0.15;
/** Pixels an element may stick out of the screen, or text its box, before it counts (rounding). */
const EDGE_TOLERANCE = 0.5;
/** Words on a screen above which it is dense. */
export const DENSITY_MAX_WORDS = 80;
/** Text elements on a screen above which it is dense. */
export const DENSITY_MAX_TEXTS = 25;
/** The font size the theme's globals give when a style says nothing (px). */
const DEFAULT_FONT_SIZE = 16;

/** A finding about element or screen `id`. */
export function finding(code: LintFinding['code'], id: string, message: string, hint: string): LintFinding {
  return { ...diagnostic(code, ['records', id], message, hint), elements: [id as RecordId] };
}

/** `f` about several elements instead of the one it points at. */
const about = (f: LintFinding, elements: readonly string[]): LintFinding => ({ ...f, elements: elements as RecordId[] });

const area = (b: Box) => b.w * b.h;

/** The overlapping area of two boxes. */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Whether `ancestor` is a parent (at any depth) of `of`. */
function contains(doc: DocumentFile, ancestor: string, of: Boxed): boolean {
  let p = of.rec['parentId'] as string | undefined;
  for (let n = 0; p !== undefined && n < 64; n += 1) {
    if (p === ancestor) return true;
    p = (doc.records[p] as { parentId?: string } | undefined)?.parentId;
  }
  return false;
}

const CONTAINER_KINDS: ReadonlySet<unknown> = new Set(['group', 'frame']);
const isContainer = (e: Boxed) => CONTAINER_KINDS.has(e.rec['kind']);

const OVERLAP: LintRule = {
  id: 'OVERLAP',
  code: 'FLX_LINT_OVERLAP',
  severity: 'warning',
  weight: 4,
  describe: 'two elements of a screen cover a large part of the smaller one',
  check(doc) {
    const out: LintFinding[] = [];
    for (const screen of screensOf(doc)) {
      const items = screen.elements.filter((e) => !isContainer(e));
      for (const [i, a] of items.entries())
        for (const b of items.slice(i + 1)) {
          const share = overlapArea(a.box, b.box) / Math.max(1, Math.min(area(a.box), area(b.box)));
          if (share < OVERLAP_MIN_SHARE || contains(doc, a.id, b) || contains(doc, b.id, a)) continue;
          const f = finding(
            'FLX_LINT_OVERLAP',
            b.id,
            `${a.id} and ${b.id} overlap by ${Math.round(share * 100)}% of the smaller one`,
            'move or resize one of them',
          );
          out.push(about(f, [a.id, b.id]));
        }
    }
    return out;
  },
};

const sticksOut = (b: Box, size: { readonly w: number; readonly h: number }) =>
  b.x < -EDGE_TOLERANCE || b.y < -EDGE_TOLERANCE || b.x + b.w > size.w + EDGE_TOLERANCE || b.y + b.h > size.h + EDGE_TOLERANCE;

const OFFSCREEN: LintRule = {
  id: 'OFFSCREEN',
  code: 'FLX_LINT_OFFSCREEN',
  severity: 'warning',
  weight: 6,
  describe: 'an element reaches past the edge of its fixed screen',
  check(doc) {
    return screensOf(doc).flatMap(({ size, elements }) =>
      size === undefined
        ? []
        : elements
            .filter((e) => sticksOut(e.box, size))
            .map((e) => finding('FLX_LINT_OFFSCREEN', e.id, `${e.id} reaches past the ${size.w}x${size.h} screen`, 'move it inside the screen or shrink it')),
    );
  },
};

/** The font an element's own style names, with the theme-free defaults for the rest. */
function fontOf(rec: Boxed['rec']): { size: number; family: string; weight: number } {
  const font = ((rec['style'] as { font?: { size?: unknown; family?: unknown; weight?: unknown } } | undefined)?.font ?? {}) as {
    size?: unknown;
    family?: unknown;
    weight?: unknown;
  };
  return {
    size: typeof font.size === 'number' ? font.size : DEFAULT_FONT_SIZE,
    family: typeof font.family === 'string' ? font.family : 'sans-serif',
    weight: typeof font.weight === 'number' ? font.weight : 400,
  };
}

const TEXT_OVERFLOW: LintRule = {
  id: 'TEXT_OVERFLOW',
  code: 'FLX_LINT_TEXT_OVERFLOW',
  severity: 'warning',
  weight: 5,
  describe: 'measured text does not fit the box of its element',
  check(doc, ctx) {
    const measure = ctx.measureText;
    if (!measure) return [];
    return screensOf(doc).flatMap((screen) =>
      screen.elements
        .filter((e) => e.text !== '' && measure(e.text, fontOf(e.rec), e.box.w).h > e.box.h + EDGE_TOLERANCE)
        .map((e) =>
          finding(
            'FLX_LINT_TEXT_OVERFLOW',
            e.id,
            `the text of ${e.id} is taller than its ${e.box.w}x${e.box.h} box`,
            'enlarge the box, shorten the text or lower the font size',
          ),
        ),
    );
  },
};

const wordsIn = (text: string) => (text === '' ? 0 : text.split(' ').length);

const DENSITY: LintRule = {
  id: 'DENSITY',
  code: 'FLX_LINT_DENSITY',
  severity: 'warning',
  weight: 5,
  describe: `a screen holds more than ${DENSITY_MAX_WORDS} words or ${DENSITY_MAX_TEXTS} text elements`,
  check(doc) {
    const out: LintFinding[] = [];
    for (const screen of screensOf(doc)) {
      const texts = screen.elements.filter((e) => e.text !== '');
      const words = texts.reduce((sum, e) => sum + wordsIn(e.text), 0);
      if (words > DENSITY_MAX_WORDS || texts.length > DENSITY_MAX_TEXTS)
        out.push(
          about(
            finding('FLX_LINT_DENSITY', screen.id, `screen ${screen.id} holds ${words} words in ${texts.length} text elements`, 'split the screen or cut text'),
            texts.map((e) => e.id),
          ),
        );
    }
    return out;
  },
};

const ORPHAN_CONNECTOR: LintRule = {
  id: 'ORPHAN_CONNECTOR',
  code: 'FLX_LINT_ORPHAN_CONNECTOR',
  severity: 'warning',
  weight: 4,
  describe: 'a connector has neither end attached to an element',
  check(doc) {
    const bound = new Set(recordsOf(doc, 'binding').map((b) => b['connectorId']));
    return recordsOf(doc, 'element')
      .filter((e) => e['kind'] === 'connector' && !bound.has(e.id) && e['hidden'] !== true)
      .map((e) => finding('FLX_LINT_ORPHAN_CONNECTOR', e.id, `connector ${e.id} is attached to nothing`, 'attach an end to an element, or delete it'));
  },
};

/** The layout rules, in report order. */
export const LAYOUT_RULES: readonly LintRule[] = [OVERLAP, OFFSCREEN, TEXT_OVERFLOW, DENSITY, ORPHAN_CONNECTOR];
