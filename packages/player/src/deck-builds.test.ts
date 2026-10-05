import { reduceBuild } from '@fluxion/anim';
import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { buildsOfScreen } from './deck-builds.js';

/** Two screens; the first has a main timeline with an onEnter and two click steps, and a named timeline whose step is not a build. */
function doc() {
  const b = documentBuilder({ seed: 23 });
  const s1 = b.screen();
  const s2 = b.screen();
  const [r1, r2, r3] = [b.rect(s1, {}), b.rect(s1, {}), b.rect(s1, {})] as [RecordId, RecordId, RecordId];
  const file = b.build();
  const step = (id: string, timelineId: string, index: string, trigger: [string, string, RecordId[]]) => ({
    id,
    type: 'step',
    timelineId,
    index,
    trigger: { kind: trigger[0] },
    animations: [{ id: `${id}a`, effect: trigger[1], targets: trigger[2] }],
  });
  const records = {
    ...file.records,
    tl: { id: 'tl', type: 'timeline', screenId: s1, name: 'main', index: 'a0' },
    named: { id: 'named', type: 'timeline', screenId: s1, name: 'highlight', index: 'a1' },
    e: step('e', 'tl', 'a0', ['onEnter', 'appear', [r1]]),
    c2: step('c2', 'tl', 'a2', ['onClick', 'disappear', [r1]]),
    c1: step('c1', 'tl', 'a1', ['onClick', 'appear', [r2]]),
    n: step('n', 'named', 'a0', ['onClick', 'appear', [r3]]),
  };
  return { store: createCore({ ...file, records } as unknown as DocumentFile, { validate: false }).store, s1, s2, r: [r1, r2, r3] as const };
}

describe('the builds of a screen (FR-PRS-003)', () => {
  it("FR-PRS-003: a screen's builds are its main timeline's steps in the timeline's order; a named timeline is not part of them; a screen without steps has none", () => {
    const { store, s1, s2, r } = doc();
    const builds = store.query((view) => buildsOfScreen(view, s1))();
    // onEnter is group 0; the click steps come in index order (c1 before c2) whatever the record order
    expect(builds.groups.map((g) => g.steps)).toEqual([['e'], ['c1'], ['c2']]);
    expect(builds.clicks).toBe(2);
    const hiddenAt = (g: number) => [...reduceBuild(builds, g).hidden].sort();
    // r2 appears at the first click, r1 (shown on entry) disappears at the second, r3 is in the named timeline and always shown
    expect(hiddenAt(0)).toEqual([r[1]]);
    expect(hiddenAt(1)).toEqual([]);
    expect(hiddenAt(2)).toEqual([r[0]]);
    expect(store.query((view) => buildsOfScreen(view, s2))().clicks).toBe(0);
  });
});
