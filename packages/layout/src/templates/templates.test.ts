// FR-LAY-014: smart templates (ADR-0047): each built-in builds its golden shapes and connectors from an items list, styled by slot role (the
// theme variant) with theme tokens; the registry, the input checks and the no-overlap guarantee.
import { createRegistry } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { comparisonTemplate } from './comparison.js';
import { cycleBasicTemplate } from './cycle.js';
import { funnelTemplate } from './funnel.js';
import { hierarchyOrgTemplate } from './hierarchy.js';
import { matrix2x2Template } from './matrix.js';
import { processBasicTemplate, processChevronTemplate } from './process.js';
import { pyramidTemplate } from './pyramid.js';
import { buildTemplate, builtInTemplates, listTemplates, registerBuiltInTemplates, registerTemplate, templateOptionsJsonSchema } from './registry.js';
import { timelineMilestonesTemplate } from './timeline.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult, TemplateShapeDraft } from './types.js';
import { vennTemplate } from './venn.js';

/** A measurer with fixed metrics: half the font size per character, lines 1.2 times the size. */
const measure: TemplateContext['measure'] = {
  measure: (text, font) => ({ width: text.length * font.size * 0.5, height: font.size * 1.2, ascent: font.size * 0.8, descent: font.size * 0.4 }),
};
const frame: Box = { x: 0, y: 0, w: 1920, h: 1080 };
const ctx: TemplateContext = { frame, measure };

const build = (template: TemplateDef<never>, items: unknown, options?: unknown, at: TemplateContext = ctx): TemplateResult => {
  const r = buildTemplate(template, items, options, at);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

/** One line per shape (key, shape, box, params, variant, fill, label) and per connector (from, to, variant). */
const lines = (r: TemplateResult): string[] => [
  ...r.shapes.map(
    (s) =>
      `${s.key} ${s.shape} ${s.box.x},${s.box.y} ${s.box.w}x${s.box.h}${s.params ? ` ${JSON.stringify(s.params)}` : ''} ${s.style.variant} ${s.style.fill} ${s.label}`,
  ),
  ...r.connectors.map((c) => `${c.from} -> ${c.to} ${c.style.variant}`),
];

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box, f: Box): boolean => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;

/** No two of `shapes` overlap and, when a frame is given, each lies inside it. */
function expectApart(id: string, shapes: readonly TemplateShapeDraft[], within?: Box): void {
  for (const [i, a] of shapes.entries()) {
    if (within) expect([id, a.key, inside(a.box, within)]).toEqual([id, a.key, true]);
    for (const b of shapes.slice(i + 1)) expect([id, a.key, b.key, overlap(a.box, b.box)]).toEqual([id, a.key, b.key, false]);
  }
}

const items = (...labels: string[]): TemplateItem[] => labels.map((label) => ({ label }));

/** A small valid items list for each built-in. */
const SAMPLE: { readonly [id: string]: readonly TemplateItem[] } = {
  'hierarchy.org': [{ label: 'A', children: items('B') }],
  'matrix.2x2': items('A', 'B', 'C', 'D'),
  comparison: [
    { label: 'A', children: items('a') },
    { label: 'B', children: items('b') },
  ],
};
const sampleOf = (id: string): readonly TemplateItem[] => SAMPLE[id] ?? items('A', 'B', 'C');
const portrait: TemplateContext = { frame: { x: 0, y: 0, w: 1080, h: 1920 }, measure };

describe('smart templates (FR-LAY-014, ADR-0047)', () => {
  it('FR-LAY-014: WHEN process.basic is built from four steps THE SYSTEM SHALL produce golden process (boxes, arrows, slot variants)', () => {
    const steps = [{ label: 'Plan', detail: 'Scope and goals' }, ...items('Build', 'Test', 'Ship')];
    expect(lines(build(processBasicTemplate as never, steps))).toEqual([
      'step-0 basic:rounded-rect 566,503 161x74 step {color.accent-1} Plan',
      'step-1 basic:rounded-rect 775,503 161x74 step {color.accent-2} Build',
      'step-2 basic:rounded-rect 984,503 161x74 step {color.accent-3} Test',
      'step-3 basic:rounded-rect 1193,503 161x74 step {color.accent-4} Ship',
      'step-0 -> step-1 arrow',
      'step-1 -> step-2 arrow',
      'step-2 -> step-3 arrow',
    ]);
    // the detail line is carried and grows the step: 74 px tall where a label alone needs 64
    expect(build(processBasicTemplate as never, steps).shapes[0]?.detail).toBe('Scope and goals');
  });

  it('FR-LAY-014: WHEN process.chevron is built THE SYSTEM SHALL produce golden process.chevron (block arrows, no connectors)', () => {
    expect(lines(build(processChevronTemplate as never, items('Research', 'Design', 'Deliver')))).toEqual([
      'step-0 basic:block-arrow 696.5,500 170.5x80 {"head":0.25,"shaft":0.8} step {color.accent-1} Research',
      'step-1 basic:block-arrow 875,500 170.5x80 {"head":0.25,"shaft":0.8} step {color.accent-2} Design',
      'step-2 basic:block-arrow 1053.5,500 170.5x80 {"head":0.25,"shaft":0.8} step {color.accent-3} Deliver',
    ]);
  });

  it('FR-LAY-014: WHEN cycle.basic is built from four items THE SYSTEM SHALL produce golden cycle (clockwise from the top, closed)', () => {
    expect(lines(build(cycleBasicTemplate as never, items('Plan', 'Do', 'Check', 'Act')))).toEqual([
      'item-0 basic:ellipse 875.5,79.5 169.5x90.5 item {color.accent-1} Plan',
      'item-1 basic:ellipse 1290.5,495 169.5x90.5 item {color.accent-2} Do',
      'item-2 basic:ellipse 875.5,910 169.5x90.5 item {color.accent-3} Check',
      'item-3 basic:ellipse 460,495 169.5x90.5 item {color.accent-4} Act',
      'item-0 -> item-1 arrow',
      'item-1 -> item-2 arrow',
      'item-2 -> item-3 arrow',
      'item-3 -> item-0 arrow',
    ]);
  });

  it('FR-LAY-014: WHEN hierarchy.org is built from nested items THE SYSTEM SHALL produce golden hierarchy.org (parents over children)', () => {
    const org = [{ label: 'CEO', children: [{ label: 'CTO', children: items('Platform', 'Apps') }, ...items('CFO', 'COO')] }];
    expect(lines(build(hierarchyOrgTemplate as never, org))).toEqual([
      'node-0 basic:rounded-rect 934,388 128x64 root {color.accent-1} CEO',
      'node-1 basic:rounded-rect 744,508 128x64 node {color.accent-2} CTO',
      'node-2 basic:rounded-rect 668,628 128x64 node {color.accent-3} Platform',
      'node-3 basic:rounded-rect 820,628 128x64 node {color.accent-3} Apps',
      'node-4 basic:rounded-rect 972,508 128x64 node {color.accent-2} CFO',
      'node-5 basic:rounded-rect 1124,508 128x64 node {color.accent-2} COO',
      'node-0 -> node-1 link',
      'node-1 -> node-2 link',
      'node-1 -> node-3 link',
      'node-0 -> node-4 link',
      'node-0 -> node-5 link',
    ]);
  });

  it('FR-LAY-014: WHEN pyramid is built from four layers THE SYSTEM SHALL produce golden pyramid (apex triangle, slopes continued)', () => {
    expect(lines(build(pyramidTemplate as never, items('Vision', 'Strategy', 'Tactics', 'Operations')))).toEqual([
      'layer-0 basic:triangle 765,40 390x244 layer {color.accent-1} Vision',
      'layer-1 basic:trapezoid 563,292 794x244 {"inset":0.246} layer {color.accent-2} Strategy',
      'layer-2 basic:trapezoid 361.5,544 1197x244 {"inset":0.163} layer {color.accent-3} Tactics',
      'layer-3 basic:trapezoid 160,796 1600x244 {"inset":0.122} layer {color.accent-4} Operations',
    ]);
  });

  it('FR-LAY-014: the colour scheme changes only the theme tokens, primary and outline alike', () => {
    const steps = items('Plan', 'Build', 'Test', 'Ship', 'Run', 'Learn', 'Repeat');
    const colorful = build(processBasicTemplate as never, steps);
    // the accents cycle after the sixth
    expect(colorful.shapes.map((s) => s.style.fill)).toEqual([1, 2, 3, 4, 5, 6, 1].map((n) => `{color.accent-${n}}`));
    const primary = build(processBasicTemplate as never, steps, { colors: 'primary' });
    const outline = build(processBasicTemplate as never, steps, { colors: 'outline' });
    for (const r of [primary, outline]) expect(r.shapes.map((s) => s.box)).toEqual(colorful.shapes.map((s) => s.box));
    expect(new Set(primary.shapes.map((s) => `${s.style.fill} ${s.style.font?.color}`))).toEqual(new Set(['{color.primary} {color.background}']));
    expect(new Set(outline.shapes.map((s) => `${s.style.fill} ${s.style.stroke.color} ${s.style.font?.color}`))).toEqual(
      new Set(['{color.surface} {color.primary} {color.text}']),
    );
  });

  it('FR-LAY-014: WHEN matrix.2x2 is built from four items THE SYSTEM SHALL produce golden matrix.2x2 (quadrants in reading order)', () => {
    expect(lines(build(matrix2x2Template as never, items('Do first', 'Schedule', 'Delegate', 'Drop')))).toEqual([
      'quadrant-0 basic:rounded-rect 160,40 792x492 quadrant {color.accent-1} Do first',
      'quadrant-1 basic:rounded-rect 968,40 792x492 quadrant {color.accent-2} Schedule',
      'quadrant-2 basic:rounded-rect 160,548 792x492 quadrant {color.accent-3} Delegate',
      'quadrant-3 basic:rounded-rect 968,548 792x492 quadrant {color.accent-4} Drop',
    ]);
  });

  it('FR-LAY-014: WHEN venn is built from three sets THE SYSTEM SHALL produce golden venn (see-through circles, each centre outside the other circles)', () => {
    const r = build(vennTemplate as never, items('Desirable', 'Feasible', 'Viable'));
    expect(lines(r)).toEqual([
      'set-0 basic:ellipse 631,40 658x658 set {color.accent-1} Desirable',
      'set-1 basic:ellipse 433.5,382 658x658 set {color.accent-2} Feasible',
      'set-2 basic:ellipse 828.5,382 658x658 set {color.accent-3} Viable',
    ]);
    expect(r.shapes.map((s) => s.style.opacity)).toEqual([0.7, 0.7, 0.7]);
    // each label sits at its circle's centre, which no other circle covers
    for (const a of r.shapes)
      for (const b of r.shapes.filter((other) => other !== a)) expect(Math.hypot(a.box.x - b.box.x, a.box.y - b.box.y)).toBeGreaterThan(b.box.w / 2);
  });

  it('FR-LAY-014: WHEN funnel is built from four stages THE SYSTEM SHALL produce golden funnel (narrowing bars)', () => {
    expect(lines(build(funnelTemplate as never, items('Visitors', 'Leads', 'Trials', 'Customers')))).toEqual([
      'stage-0 basic:rounded-rect 160,40 1600x244 stage {color.accent-1} Visitors',
      'stage-1 basic:rounded-rect 320,292 1280x244 stage {color.accent-2} Leads',
      'stage-2 basic:rounded-rect 480,544 960x244 stage {color.accent-3} Trials',
      'stage-3 basic:rounded-rect 640,796 640x244 stage {color.accent-4} Customers',
    ]);
  });

  it('FR-LAY-014: WHEN timeline.milestones is built THE SYSTEM SHALL produce golden timeline.milestones (markers joined, labels alternating)', () => {
    expect(lines(build(timelineMilestonesTemplate as never, items('Kickoff', 'Alpha', 'Beta', 'Launch')))).toEqual([
      'marker-0 basic:ellipse 88,528 24x24 marker {color.accent-1} ',
      'milestone-0 basic:rounded-rect 40,448 120x64 milestone {color.accent-1} Kickoff',
      'marker-1 basic:ellipse 661.5,528 24x24 marker {color.accent-2} ',
      'milestone-1 basic:rounded-rect 613.5,568 120x64 milestone {color.accent-2} Alpha',
      'marker-2 basic:ellipse 1234.5,528 24x24 marker {color.accent-3} ',
      'milestone-2 basic:rounded-rect 1186.5,448 120x64 milestone {color.accent-3} Beta',
      'marker-3 basic:ellipse 1808,528 24x24 marker {color.accent-4} ',
      'milestone-3 basic:rounded-rect 1760,568 120x64 milestone {color.accent-4} Launch',
      'marker-0 -> marker-1 line',
      'marker-1 -> marker-2 line',
      'marker-2 -> marker-3 line',
    ]);
  });

  it('FR-LAY-014: WHEN comparison is built from two sides THE SYSTEM SHALL produce golden comparison (headers over outlined points)', () => {
    const sides = [
      { label: 'Build', children: items('Full control', 'Slower start') },
      { label: 'Buy', children: items('Fast start', 'Licence cost', 'Lock-in') },
    ];
    const r = build(comparisonTemplate as never, sides);
    expect(lines(r)).toEqual([
      'header-0 basic:rounded-rect 40,400 904x64 header {color.accent-1} Build',
      'point-0-0 basic:rounded-rect 40,472 904x64 point {color.surface} Full control',
      'point-0-1 basic:rounded-rect 40,544 904x64 point {color.surface} Slower start',
      'header-1 basic:rounded-rect 976,400 904x64 header {color.accent-2} Buy',
      'point-1-0 basic:rounded-rect 976,472 904x64 point {color.surface} Fast start',
      'point-1-1 basic:rounded-rect 976,544 904x64 point {color.surface} Licence cost',
      'point-1-2 basic:rounded-rect 976,616 904x64 point {color.surface} Lock-in',
    ]);
    // a point is outlined in its side's header colour
    expect(r.shapes.filter((s) => s.slot === 'point').map((s) => s.style.stroke.color)).toEqual([
      '{color.accent-1}',
      '{color.accent-1}',
      '{color.accent-2}',
      '{color.accent-2}',
      '{color.accent-2}',
    ]);
    expect(buildTemplate(comparisonTemplate as never, items('only one'), undefined, ctx).ok).toBe(false);
    const crowded = [{ label: 'A', children: items(...'abcdefghi') }, { label: 'B' }];
    expect(buildTemplate(comparisonTemplate as never, crowded, undefined, ctx)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/at most 8 points/),
    });
  });

  it('FR-LAY-014: WHEN a portrait frame is given THE SYSTEM SHALL adapt the direction (timeline down, comparison in rows)', () => {
    const timeline = build(timelineMilestonesTemplate as never, items('Kickoff', 'Alpha', 'Beta', 'Launch'), undefined, portrait);
    const markers = timeline.shapes.filter((s) => s.slot === 'marker');
    expect(new Set(markers.map((s) => s.box.x))).toEqual(new Set([528]));
    expect(markers.map((s) => s.box.y)).toEqual([...markers.map((s) => s.box.y)].sort((a, b) => a - b));
    const sides = [
      { label: 'Build', children: items('Full control') },
      { label: 'Buy', children: items('Fast start') },
    ];
    const headers = build(comparisonTemplate as never, sides, undefined, portrait).shapes.filter((s) => s.slot === 'header');
    expect(headers.map((s) => s.box.x)).toEqual([40, 40]);
    expect(headers[1]?.box.y).toBeGreaterThan(headers[0]?.box.y ?? Number.POSITIVE_INFINITY);
    // rows hold in a landscape frame too
    const rows = build(comparisonTemplate as never, sides, { direction: 'rows' }).shapes.filter((s) => s.slot === 'header');
    expect(rows.map((s) => s.box.x)).toEqual([40, 40]);
    // every built-in fits a portrait frame
    for (const template of builtInTemplates)
      for (const s of build(template, sampleOf(template.id), undefined, portrait).shapes)
        expect([template.id, s.key, inside(s.box, portrait.frame)]).toEqual([template.id, s.key, true]);
  });

  it("FR-LAY-014: every built shape and connector carries its slot role as its theme variant, drawn with the slot's shape", () => {
    for (const template of builtInTemplates) {
      const r = build(template, sampleOf(template.id));
      for (const s of [...r.shapes, ...r.connectors]) expect([template.id, s.style.variant]).toEqual([template.id, template.slots[s.slot]?.role]);
      for (const s of r.shapes) expect([template.id, s.shape]).toEqual([template.id, template.slots[s.slot]?.shape]);
    }
  });

  it('FR-LAY-014: a portrait frame turns process.basic down; an explicit down runs down in any frame', () => {
    const tall = build(processBasicTemplate as never, items('A', 'B', 'C'), undefined, portrait);
    expect(new Set(tall.shapes.map((s) => s.box.x)).size).toBe(1);
    const down = build(processBasicTemplate as never, items('A', 'B', 'C'), { direction: 'down' });
    expect(down.shapes.map((s) => s.box.y)).toEqual([...down.shapes.map((s) => s.box.y)].sort((a, b) => a - b));
    expect(new Set(down.shapes.map((s) => s.box.x)).size).toBe(1);
  });

  it('FR-LAY-014: items and options are checked, with the wrong input named; nothing throws', () => {
    const refused = (template: TemplateDef<never>, i: unknown, o?: unknown): string => {
      const r = buildTemplate(template, i, o, ctx);
      return r.ok ? 'built' : r.message;
    };
    expect(refused(cycleBasicTemplate as never, items('only one'))).toMatch(/^cycle\.basic items: value: /);
    expect(refused(processBasicTemplate as never, [{ label: 3 }])).toMatch(/^process\.basic items: 0\.label: /);
    expect(refused(processBasicTemplate as never, items('A'), { direction: 'up' })).toMatch(/^process\.basic options: direction: /);
    expect(refused(pyramidTemplate as never, items('A'), { other: 1 })).toMatch(/^pyramid options: /);
    expect(refused(processBasicTemplate as never, 'A, B')).toMatch(/^process\.basic items: /);
    // a hostile depth is one refusal, never a stack overflow
    let deep: TemplateItem = { label: 'leaf' };
    for (let i = 0; i < 20_000; i++) deep = { label: `n${i}`, children: [deep] };
    expect(refused(hierarchyOrgTemplate as never, [deep])).toMatch(/nest deeper than 64 levels/);
    // so is a hostile breadth: the items in all are counted, children included
    expect(refused(hierarchyOrgTemplate as never, [{ label: 'r', children: Array.from({ length: 200_000 }, (_, i) => ({ label: `c${i}` })) }])).toMatch(
      /more than 256 items in all/,
    );
    expect(refused(hierarchyOrgTemplate as never, [{ label: 'r', children: Array.from({ length: 255 }, (_, i) => ({ label: `c${i}` })) }])).toBe('built');
  });

  it('FR-LAY-014: built shapes never overlap; within a frame that holds them, they stay inside it', () => {
    const label = fc.string({ minLength: 1, maxLength: 30 });
    const flat = (min: number, max: number) =>
      fc.array(
        label.map((l) => ({ label: l })),
        { minLength: min, maxLength: max },
      );
    const cases: [TemplateDef<never>, fc.Arbitrary<TemplateItem[]>][] = [
      [processBasicTemplate as never, flat(1, 12)],
      [processChevronTemplate as never, flat(1, 12)],
      [cycleBasicTemplate as never, flat(2, 12)],
      [pyramidTemplate as never, flat(1, 10)],
      [matrix2x2Template as never, flat(4, 4)],
      [funnelTemplate as never, flat(2, 8)],
      [timelineMilestonesTemplate as never, flat(2, 12)],
      [
        comparisonTemplate as never,
        fc.tuple(flat(0, 8), flat(0, 8)).map(([a, b]) => [
          { label: 'A', children: a },
          { label: 'B', children: b },
        ]),
      ],
    ];
    // every count the items schema takes, with any gap down to touching (rounding must not push a box onto the next)
    const gap = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 64 }));
    for (const [template, arbitrary] of cases)
      fc.assert(
        fc.property(arbitrary, gap, (list, g) => {
          expectApart(template.id, build(template, list, ['cycle.basic', 'timeline.milestones'].includes(template.id) ? undefined : { gap: g }).shapes, frame);
        }),
      );
    // org charts of any shape: no two boxes overlap, however many leaves
    const treeOf = (depth: number): fc.Arbitrary<TemplateItem> =>
      depth === 0 ? label.map((l) => ({ label: l })) : fc.record({ label, children: fc.array(treeOf(depth - 1), { maxLength: 3 }) });
    const tree = treeOf(3);
    fc.assert(
      fc.property(fc.array(tree, { minLength: 1, maxLength: 3 }), gap, gap, (roots, g, levelGap) => {
        expectApart('hierarchy.org', build(hierarchyOrgTemplate as never, roots, { gap: g, levelGap }).shapes);
      }),
    );
  });

  it('FR-LAY-014: the built-ins register and list by id; a malformed or taken template is refused with its reason', () => {
    const templates = createRegistry<string, unknown>('templates');
    expect(registerBuiltInTemplates(templates)).toEqual({ ok: true });
    expect(listTemplates(templates).map((t) => t.id)).toEqual([
      'comparison',
      'cycle.basic',
      'funnel',
      'hierarchy.org',
      'matrix.2x2',
      'process.basic',
      'process.chevron',
      'pyramid',
      'timeline.milestones',
      'venn',
    ]);
    expect(registerTemplate(templates, { ...pyramidTemplate, build: undefined } as never, 'pack').ok).toBe(false);
    expect(registerTemplate(templates, { ...pyramidTemplate, items: undefined } as never, 'pack')).toEqual({
      ok: false,
      message: 'template "pyramid" needs an items schema',
    });
    expect(registerTemplate(templates, pyramidTemplate, 'pack').ok).toBe(false);
    expect(registerTemplate(templates, { ...pyramidTemplate, id: 'pack:pyramid' }, 'pack')).toEqual({ ok: true });
    expect(templateOptionsJsonSchema(pyramidTemplate as never)).toMatchObject({
      properties: { gap: { default: 8 }, colors: { enum: ['colorful', 'primary', 'outline'] } },
    });
  });
});
