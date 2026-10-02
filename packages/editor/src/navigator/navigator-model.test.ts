import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import {
  dropAfter,
  duplicateArgs,
  formatArgs,
  formatLabel,
  navigatorItems,
  newScreen,
  parseSize,
  type Row,
  type SectionRow,
  sectionMoves,
  shownSize,
} from './navigator-model.js';
import { movedTo } from './use-sections.js';

const [a, b, c, d] = ['A', 'B', 'C', 'D'] as [RecordId, RecordId, RecordId, RecordId];

describe('the navigator model (FR-SCR-002)', () => {
  it('FR-SCR-002: a drop lands above or below its target, and a drop that changes nothing is none', () => {
    const order = [a, b, c, d];
    // above the first: the first place
    expect(dropAfter(order, d, a, false)).toBeUndefined();
    // below the first, above the second: both follow A
    expect(dropAfter(order, d, a, true)).toBe(a);
    expect(dropAfter(order, d, b, false)).toBe(a);
    // moving down: below D follows D, above D follows C
    expect(dropAfter(order, a, d, true)).toBe(d);
    expect(dropAfter(order, a, d, false)).toBe(c);
    // where it already is, and on itself
    expect(dropAfter(order, b, c, false)).toBeNull();
    expect(dropAfter(order, b, a, true)).toBeNull();
    expect(dropAfter(order, b, b, true)).toBeNull();
    expect(dropAfter(order, a, a, false)).toBeNull();
  });

  it('FR-SCR-002: a new screen follows the last one, and a duplicate gets a distinct new id for each record it copies', () => {
    const builder = documentBuilder({ seed: 301 });
    const first = builder.screen();
    const last = builder.screen();
    const left = builder.rect(first, { x: 0 });
    const right = builder.rect(first, { x: 200 });
    builder.connect(left, right);
    const { store } = createCore(builder.build());
    const made = newScreen(store, 'NewScreen0000001' as RecordId);
    expect(made).toMatchObject({ id: 'NewScreen0000001', type: 'screen' });
    expect(made.index > String((store.get(last) as { index?: unknown }).index)).toBe(true);
    // none yet: the first key
    expect(newScreen(createCore(documentBuilder({ seed: 302 }).build()).store, 'OnlyScreen000001' as RecordId).index).toBe('a0');
    let n = 0;
    const args = duplicateArgs(store, first, () => `Fresh${String(++n).padStart(10, '0')}` as RecordId);
    // two shapes, the connector, and its two bindings
    expect(Object.keys(args.ids)).toHaveLength(5);
    expect(new Set([args.newId, ...Object.values(args.ids)]).size).toBe(6);
  });

  it('FR-SCR-003: formats are named, parsed and turned into screen.setFormat arguments', () => {
    expect([formatLabel({}), formatLabel({ size: { w: 1600, h: 1200 } }), formatLabel({ size: { w: 1280, h: 720 } })]).toEqual(['16:9', '4:3', '1280×720']);
    expect(formatLabel({ kind: 'infinite' })).toBe('Infinite');
    expect(['1280x720', ' 800 × 600 ', '640,480', '12x720', '1280x', 'abc', '99999x600', '800x20000'].map(parseSize)).toEqual([
      { w: 1280, h: 720 },
      { w: 800, h: 600 },
      { w: 640, h: 480 },
      undefined,
      undefined,
      undefined,
      undefined,
      { w: 800, h: 20000 },
    ]);
    const id = 'S' as RecordId;
    expect(formatArgs('screen.format:9:16', id, { w: 1, h: 1 })).toEqual({ id, format: { kind: 'fixed', size: { w: 1080, h: 1920 } } });
    expect(formatArgs('screen.format:infinite', id, { w: 1600, h: 900 })).toEqual({
      id,
      format: { kind: 'infinite', viewport: { x: 0, y: 0, w: 1600, h: 900 } },
    });
    expect([formatArgs('screen.format:custom', id, { w: 1, h: 1 }), formatArgs('screen.format:nope', id, { w: 1, h: 1 })]).toEqual([undefined, undefined]);
  });

  it('FR-SCR-003: a format change on an infinite screen keeps its viewport', () => {
    const id = 'S' as RecordId;
    const viewport = { x: -300, y: 40, w: 1400, h: 700 };
    // the size shown is the viewport's, not the default 1920 x 1080
    expect(shownSize({ kind: 'infinite', viewport })).toEqual({ w: 1400, h: 700 });
    expect(shownSize({})).toEqual({ w: 1920, h: 1080 });
    // choosing Infinite again changes nothing; a preset or a custom size replaces it
    expect(formatArgs('screen.format:infinite', id, { w: 1400, h: 700, infinite: true })).toBeUndefined();
    expect(formatArgs('screen.format:4:3', id, { w: 1400, h: 700, infinite: true })?.format.kind).toBe('fixed');
  });

  const row = (id: string, sectionId?: string): Row => ({
    id: id as RecordId,
    label: id,
    hidden: false,
    format: '16:9',
    size: { w: 1920, h: 1080 },
    ...(sectionId === undefined ? {} : { sectionId: sectionId as RecordId }),
  });
  const sec = (id: string, collapsed = false): SectionRow => ({ id: id as RecordId, name: id, collapsed });

  it('FR-SCR-004: the navigator lists free screens first, then each section with its screens, and a folded one alone', () => {
    const rows = [row('s1', 'A'), row('s2'), row('s3', 'B'), row('s4', 'A'), row('s5', 'gone')];
    const show = (items: ReturnType<typeof navigatorItems>) => items.map((i) => (i.kind === 'section' ? `#${i.section.id}:${i.count}` : i.row.id));
    // a screen naming no section that exists is listed with the free ones; a section keeps its screens' order
    expect(show(navigatorItems(rows, [sec('A'), sec('B')]))).toEqual(['s2', 's5', '#A:2', 's1', 's4', '#B:1', 's3']);
    expect(show(navigatorItems(rows, [sec('A', true), sec('B')]))).toEqual(['s2', 's5', '#A:2', '#B:1', 's3']);
    expect(show(navigatorItems(rows, []))).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(show(navigatorItems([], [sec('A')]))).toEqual(['#A:0']);
  });

  it('FR-SCR-004: the screen menu offers the other sections and a way out; a section moves one place at a time', () => {
    const sections = [sec('A'), sec('B'), sec('C')];
    expect(sectionMoves(sections, undefined).map((m) => m.command)).toEqual(['screen.section:A', 'screen.section:B', 'screen.section:C']);
    expect(sectionMoves(sections, 'B' as RecordId).map((m) => m.command)).toEqual(['screen.section:A', 'screen.section:C', 'screen.section:none']);
    const id = (x: string) => x as RecordId;
    // up: after the one before the one above (the first place has no `after`); down: after the one below
    expect([movedTo(sections, id('C'), -1), movedTo(sections, id('B'), -1), movedTo(sections, id('A'), -1)]).toEqual([{ after: 'A' }, {}, null]);
    expect([movedTo(sections, id('A'), 1), movedTo(sections, id('B'), 1), movedTo(sections, id('C'), 1), movedTo(sections, id('X'), 1)]).toEqual([
      { after: 'B' },
      { after: 'C' },
      null,
      null,
    ]);
  });
});
