import { createCore } from '@fluxion/core';
import { VirtualClock } from '@fluxion/core/testing';
import { presentationOrder } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { type DeckSource, type Position, PresentationController } from './presentation-controller.js';

/** Five screens in a document with the third hidden; the controller presents what `presentationOrder` gives, and `groups` says how many build groups each screen has. */
function deck(groups: { [index: number]: number } = {}) {
  const builder = documentBuilder({ seed: 17 });
  const ids = [1, 2, 3, 4, 5].map(() => builder.screen()) as RecordId[];
  const file = builder.build();
  const records = structuredClone(file.records) as Record<string, Record<string, unknown>>;
  Object.assign(records[ids[2] as RecordId] as object, { hidden: true });
  const store = createCore({ ...file, records } as DocumentFile, { validate: false }).store;
  const source: DeckSource = {
    screens: () => store.query((view) => presentationOrder(view, false))(),
    groups: (screen) => groups[ids.indexOf(screen)] ?? 0,
  };
  const clock = new VirtualClock();
  return { ids, controller: new PresentationController(source, clock), clock };
}

const visited = (controller: PresentationController, moves: number): (Position | undefined)[] => {
  const seen = [controller.position()];
  for (let i = 0; i < moves; i++) {
    controller.next();
    seen.push(controller.position());
  }
  return seen;
};

describe('PresentationController (FR-PRS-002, FR-SCR-002)', () => {
  it('FR-SCR-002: a hidden screen is never visited by next', () => {
    const { ids, controller } = deck();
    const seen = visited(controller, 6).map((p) => ids.indexOf(p?.screen as RecordId) + 1);
    // screens 1 2 4 5, then it stays on 5: screen 3 is hidden
    expect(seen).toEqual([1, 2, 4, 5, 5, 5, 5]);
    expect(controller.next()).toBe(false);
    controller.first();
    expect(controller.goTo(ids[2] as RecordId)).toBe(false);
    expect(controller.position()?.screen).toBe(ids[0]);
  });

  it('FR-PRS-002: next plays the groups of a screen before leaving it and prev takes them back', () => {
    const { ids, controller } = deck({ 1: 2 });
    const at = () => `${ids.indexOf(controller.position()?.screen as RecordId) + 1}.${controller.position()?.group}`;
    const forward = [at()];
    for (let i = 0; i < 4; i++) {
      controller.next();
      forward.push(at());
    }
    expect(forward).toEqual(['1.0', '2.0', '2.1', '2.2', '4.0']);
    const back = [at()];
    for (let i = 0; i < 4; i++) {
      controller.prev();
      back.push(at());
    }
    // going back shows the previous screen complete, then takes its groups back
    expect(back).toEqual(['4.0', '2.2', '2.1', '2.0', '1.0']);
    expect(controller.prev()).toBe(false);
  });

  it("FR-PRS-002: first, last and goTo jump, a group is kept inside the screen's count, and each move is told to the listeners once", () => {
    const { ids, controller } = deck({ 3: 3 });
    const told: (Position | undefined)[] = [];
    controller.subscribe((p) => told.push(p));
    controller.last();
    expect(controller.position()).toEqual({ screen: ids[4], group: 0 });
    expect(controller.goTo(ids[3] as RecordId, 9)).toBe(true);
    expect(controller.position()).toEqual({ screen: ids[3], group: 3 });
    expect(controller.goTo(ids[3] as RecordId, -4)).toBe(true);
    expect(controller.position()?.group).toBe(0);
    controller.first();
    // arriving where it already is tells nobody
    controller.first();
    expect(told.map((p) => `${ids.indexOf(p?.screen as RecordId) + 1}.${p?.group}`)).toEqual(['5.0', '4.3', '4.0', '1.0']);
  });

  it('FR-PRS-002: goTo and the history return to earlier positions', () => {
    const { ids, controller, clock } = deck();
    clock.advance(1000);
    controller.goTo(ids[3] as RecordId);
    clock.advance(500);
    controller.goTo(ids[1] as RecordId);
    expect(controller.history().map((v) => [ids.indexOf(v.screen) + 1, v.at])).toEqual([
      [1, 0],
      [4, 1000],
      [2, 1500],
    ]);
    expect(controller.back()).toBe(true);
    expect(controller.position()?.screen).toBe(ids[3]);
    expect(controller.back()).toBe(true);
    expect(controller.position()?.screen).toBe(ids[0]);
    expect(controller.back()).toBe(false);
  });

  it('FR-PRS-002: a document that changes under the presentation leaves it on a screen that exists', () => {
    let screens: RecordId[] = ['a', 'b', 'c'] as RecordId[];
    const controller = new PresentationController({ screens: () => screens }, new VirtualClock());
    controller.goTo('b' as RecordId);
    screens = ['a', 'c'] as RecordId[];
    expect(controller.position()?.screen).toBe('a');
    screens = [];
    expect(controller.position()).toBeUndefined();
    expect(controller.next()).toBe(false);
  });

  it('FR-PRS-002: arriving where the presentation already is records nothing, so back leaves the screen in one press, and tells the right listeners', () => {
    const { ids, controller } = deck();
    const told: string[] = [];
    controller.subscribe((p) => told.push(`${ids.indexOf(p?.screen as RecordId) + 1}`));
    controller.first();
    controller.first();
    controller.next();
    expect(controller.history().map((v) => ids.indexOf(v.screen) + 1)).toEqual([1, 2]);
    expect(controller.back()).toBe(true);
    expect(controller.position()?.screen).toBe(ids[0]);
    // the move from 2 back to 1 is told, though 1 is also where the presentation started
    expect(told).toEqual(['2', '1']);
  });

  it('FR-PRS-002: a group is kept inside the count when it shrinks, a group that is not a number is 0, and the history is bounded', () => {
    let count = 3;
    const screens = ['a', 'b'] as RecordId[];
    const controller = new PresentationController({ screens: () => screens, groups: () => count }, new VirtualClock());
    controller.goTo('a' as RecordId, 3);
    count = 1;
    expect(controller.position()).toEqual({ screen: 'a', group: 1 });
    expect(controller.goTo('b' as RecordId, Number.NaN)).toBe(true);
    expect(controller.position()).toEqual({ screen: 'b', group: 0 });
    // many moves keep a bounded history that back still walks
    for (let i = 0; i < 500; i++) controller.goTo((i % 2 === 0 ? 'a' : 'b') as RecordId, i % 2);
    expect(controller.history().length).toBeLessThanOrEqual(200);
    expect(controller.back()).toBe(true);
  });
});
