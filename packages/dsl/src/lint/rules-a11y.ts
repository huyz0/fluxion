// The accessibility rules (NFR-A11Y-006, FR-AI-005): ALT_MISSING and READING_ORDER.
import { finding } from './rules-layout.js';
import type { LintFinding, LintRule } from './types.js';
import { type Boxed, screensOf } from './view.js';

/** The share of element pairs that may be out of reading order before a screen's order reads as wrong. */
export const READING_ORDER_MAX_INVERSIONS = 0.5;
/** Fewer elements than this have no order worth checking. */
const READING_ORDER_MIN_ELEMENTS = 3;

/** The accessible name of an element: its semantic label. */
const nameOf = (e: Boxed): string => {
  const label = (e.rec['semantic'] as { label?: unknown } | undefined)?.label;
  return typeof label === 'string' ? label.trim() : '';
};

/** Kinds a reader cannot name without alt text, and kinds that need it only when they carry a role (ADR-0039's alt-text set). */
const ALWAYS_NAMED: ReadonlySet<unknown> = new Set(['image', 'icon']);
const NAMED_WITH_ROLE: ReadonlySet<unknown> = new Set(['group']);

/** Whether `e` is an image, an icon, or a group that carries a role: an element whose name is its alt text. */
export function needsAlt(e: Boxed): boolean {
  const kind = e.rec['kind'];
  const role = (e.rec['semantic'] as { role?: unknown } | undefined)?.role;
  return ALWAYS_NAMED.has(kind) || (NAMED_WITH_ROLE.has(kind) && typeof role === 'string');
}

const ALT_MISSING: LintRule = {
  id: 'ALT_MISSING',
  code: 'FLX_LINT_ALT_MISSING',
  severity: 'warning',
  weight: 2,
  describe: 'an image, an icon or a role-bearing group has no accessible name (alt text)',
  check(doc) {
    return screensOf(doc).flatMap((screen) =>
      screen.elements
        .filter((e) => needsAlt(e) && nameOf(e) === '' && e.text === '')
        .map((e) => finding('FLX_LINT_ALT_MISSING', e.id, `${e.id} has no accessible name`, 'add `alt: <what it shows>` to the node')),
    );
  },
};

/** The reading position of an element: its row band, then its column. Rows are as tall as the median element. */
function readingKeys(elements: readonly Boxed[]): ReadonlyMap<string, readonly [number, number]> {
  const heights = elements.map((e) => e.box.h).sort((a, b) => a - b);
  const band = Math.max(1, heights[Math.floor(heights.length / 2)] ?? 1);
  return new Map(elements.map((e) => [e.id, [Math.floor((e.box.y + e.box.h / 2) / band), e.box.x + e.box.w / 2] as const]));
}

type Key = readonly [number, number];

/** -1, 0 or 1: `a` reads before, together with, or after `b`. */
const compareKeys = (a: Key, b: Key): number => (a[0] !== b[0] ? Math.sign(a[0] - b[0]) : Math.sign(a[1] - b[1]));

const byIndex = (a: Boxed, b: Boxed): number => {
  const [x, y] = [String(a.rec['index']), String(b.rec['index'])];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The share of pairs, taken in `index` order, that the reading order puts the other way round. */
function inversionShare(elements: readonly Boxed[]): number {
  const keys = readingKeys(elements);
  const keyed = [...elements].sort(byIndex).map((e) => keys.get(e.id) as Key);
  let inverted = 0;
  let pairs = 0;
  for (let i = 0; i < keyed.length; i++)
    for (let j = i + 1; j < keyed.length; j++) {
      const order = compareKeys(keyed[i] as Key, keyed[j] as Key);
      if (order === 0) continue;
      pairs++;
      if (order > 0) inverted++;
    }
  return pairs === 0 ? 0 : inverted / pairs;
}

const READING_ORDER: LintRule = {
  id: 'READING_ORDER',
  code: 'FLX_LINT_READING_ORDER',
  severity: 'warning',
  weight: 2,
  describe: `a screen's element order (what a screen reader follows) disagrees with its visual order, top to bottom then left to right, for more than ${READING_ORDER_MAX_INVERSIONS * 100}% of pairs`,
  check(doc) {
    const out: LintFinding[] = [];
    for (const screen of screensOf(doc)) {
      if (screen.elements.length < READING_ORDER_MIN_ELEMENTS) continue;
      const share = inversionShare(screen.elements);
      if (share > READING_ORDER_MAX_INVERSIONS)
        out.push(
          finding(
            'FLX_LINT_READING_ORDER',
            screen.id,
            `screen ${screen.id}: ${Math.round(share * 100)}% of its elements come in an order that is not the visual one`,
            'write the nodes in the order a person reads them: top to bottom, left to right',
          ),
        );
    }
    return out;
  },
};

/** The accessibility rules, in report order. */
export const A11Y_RULES: readonly LintRule[] = [ALT_MISSING, READING_ORDER];
