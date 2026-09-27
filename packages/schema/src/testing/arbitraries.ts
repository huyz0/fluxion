// fast-check arbitraries of valid documents (testing.md §4), built through the builders so every
// generated document is valid by construction; numbers sit on the canonical 1e-3 grid.
import fc from 'fast-check';
import type { DocumentFile } from '../document-file.js';
import type { RecordId } from '../ids.js';
import type { ElementRecord } from '../records/element.js';
import { type DocumentBuilder, documentBuilder, type RectOptions } from './builders.js';

const grid = (min: number, max: number): fc.Arbitrary<number> => fc.integer({ min: min * 1000, max: max * 1000 }).map((n) => n / 1000);
const slugPart = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

/**
 * Options of a generated shape.
 *
 * @public
 */
export const arbRectOptions: fc.Arbitrary<RectOptions> = fc.record(
  {
    x: grid(-2000, 2000),
    y: grid(-2000, 2000),
    w: grid(0, 800),
    h: grid(0, 800),
    rot: grid(-360, 360),
    label: fc.string({ minLength: 1, maxLength: 12 }),
    defId: fc.constantFrom('basic:rect' as const, 'basic:ellipse' as const, 'flow:decision' as const),
  },
  { requiredKeys: ['x', 'y', 'w', 'h'] },
);

type Op =
  | { readonly kind: 'screen' }
  | { readonly kind: 'rect'; readonly options: RectOptions }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'connect'; readonly a: number; readonly b: number; readonly route: 'straight' | 'orthogonal' | 'curved' };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'screen' }) },
  { weight: 4, arbitrary: arbRectOptions.map((options): Op => ({ kind: 'rect', options })) },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 20 }).map((text): Op => ({ kind: 'text', text })) },
  {
    weight: 2,
    arbitrary: fc
      .record({ a: fc.nat(), b: fc.nat(), route: fc.constantFrom('straight' as const, 'orthogonal' as const, 'curved' as const) })
      .map((c): Op => ({ kind: 'connect', ...c })),
  },
);

type Building = { readonly b: DocumentBuilder; screen: RecordId; readonly elements: RecordId[]; readonly slugs: readonly string[]; slug: number };

/** Apply one generated operation to the document being built. */
function apply(st: Building, op: Op): void {
  if (op.kind === 'screen') {
    st.screen = st.b.screen();
    st.elements.length = 0;
  } else if (op.kind === 'rect') {
    const s = st.slugs[st.slug++];
    st.elements.push(st.b.rect(st.screen, s === undefined ? op.options : { ...op.options, slug: s }));
  } else if (op.kind === 'text') st.elements.push(st.b.text(st.screen, op.text));
  else connect(st, op);
}

function connect(st: Building, op: Extract<Op, { kind: 'connect' }>): void {
  const a = st.elements[op.a % Math.max(1, st.elements.length)];
  const c = st.elements[op.b % Math.max(1, st.elements.length)];
  if (a !== undefined && c !== undefined) st.b.connect(a, c, { route: op.route });
}

/**
 * A valid document: one to a few screens with shapes, texts and bound connectors, unique slugs.
 *
 * @public
 */
export const arbDocument: fc.Arbitrary<DocumentFile> = fc
  .record({
    seed: fc.integer(),
    title: fc.string({ maxLength: 20 }),
    ops: fc.array(arbOp, { maxLength: 30 }),
    slugs: fc.uniqueArray(slugPart, { maxLength: 30 }),
  })
  .map(({ seed, title, ops, slugs }) => {
    const b = documentBuilder({ seed, title });
    const st: Building = { b, screen: b.screen(), elements: [], slugs, slug: 0 };
    for (const op of ops) apply(st, op);
    return b.build();
  });

/**
 * A valid element record (shape, text, or connector with free ends) on a screen with id
 * `screenId` of its own one-screen document; `document` holds it, so it can be validated in place.
 *
 * @public
 */
export const arbElement: fc.Arbitrary<{ readonly element: ElementRecord; readonly document: DocumentFile }> = fc
  .record({
    seed: fc.integer(),
    kind: fc.constantFrom('shape' as const, 'text' as const, 'connector' as const),
    options: arbRectOptions,
    text: fc.string({ minLength: 1, maxLength: 12 }),
  })
  .map(({ seed, kind, options, text }) => {
    const b = documentBuilder({ seed });
    const screen = b.screen();
    const id =
      kind === 'shape'
        ? b.rect(screen, options)
        : kind === 'text'
          ? b.text(screen, text, options)
          : b.connect({ x: options.x ?? 0, y: options.y ?? 0 }, { x: options.w ?? 0, y: options.h ?? 0 });
    const document = b.build();
    const element = document.records[id] as ElementRecord;
    return { element, document };
  });
