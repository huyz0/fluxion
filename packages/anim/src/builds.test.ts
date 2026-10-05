import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type BuildStep, compileBuilds, reduceBuild } from './builds.js';

const step = (id: string, kind: string, ...animations: [string, string[]][]): BuildStep => ({
  id,
  trigger: { kind },
  animations: animations.map(([effect, targets]) => ({ effect, targets })),
});
const hiddenAt = (steps: BuildStep[], group: number) => [...reduceBuild(compileBuilds(steps), group).hidden].sort();

describe('build groups (FR-PRS-003)', () => {
  it('FR-PRS-003: onEnter steps are group 0 wherever they stand, a click starts a group and with/after-previous steps join it', () => {
    const builds = compileBuilds([
      step('c1', 'onClick', ['appear', ['a']]),
      step('w1', 'withPrevious', ['appear', ['b']]),
      step('e1', 'onEnter', ['disappear', ['x']]),
      step('c2', 'onEvent', ['appear', ['c']]),
      step('p1', 'afterPrevious', ['disappear', ['a']]),
      step('c3', 'onTime', ['appear', ['d']]),
      step('c4', 'onSomethingNew', ['appear', ['e']]),
    ]);
    expect(builds.groups.map((g) => g.steps)).toEqual([['e1'], ['c1', 'w1'], ['c2', 'p1'], ['c3'], ['c4']]);
    expect(builds.clicks).toBe(4);
  });

  it('FR-PRS-003: a with-previous step before any click joins group 0', () => {
    const builds = compileBuilds([step('w0', 'withPrevious', ['appear', ['a']]), step('c1', 'onClick', ['appear', ['b']])]);
    expect(builds.groups.map((g) => g.steps)).toEqual([['w0'], ['c1']]);
  });

  it('FR-PRS-003: an element whose first effect is appear starts hidden and shows at its group; disappear hides it from its group on', () => {
    const steps = [
      step('e', 'onEnter', ['appear', ['intro']]),
      step('c1', 'onClick', ['appear', ['a']], ['disappear', ['intro']]),
      step('c2', 'onClick', ['disappear', ['b']]),
      step('c3', 'onClick', ['appear', ['b']], ['fly-in', ['z']]),
    ];
    expect(hiddenAt(steps, 0)).toEqual(['a']);
    expect(hiddenAt(steps, 1)).toEqual(['intro']);
    expect(hiddenAt(steps, 2)).toEqual(['b', 'intro']);
    expect(hiddenAt(steps, 3)).toEqual(['intro']);
    // beyond the last group is the last; before 0 is 0; not a number is 0
    expect(hiddenAt(steps, 99)).toEqual(hiddenAt(steps, 3));
    expect(hiddenAt(steps, -2)).toEqual(hiddenAt(steps, 0));
    expect(hiddenAt(steps, Number.NaN)).toEqual(hiddenAt(steps, 0));
  });

  it('FR-PRS-003: a screen without steps has one group, shows everything and a click takes nothing', () => {
    const builds = compileBuilds([]);
    expect(builds.clicks).toBe(0);
    expect(reduceBuild(builds, 5).hidden.size).toBe(0);
  });

  it('FR-PRS-003: seeking group k equals stepping k times from 0', () => {
    const steps = fc.array(fc.record({ trigger: TRIGGER, animations: fc.array(ANIMATION, { maxLength: 3 }) }), { maxLength: 12 });
    fc.assert(
      fc.property(steps, (list) => {
        const all: BuildStep[] = list.map((s, i) => ({ id: `s${i}`, trigger: { kind: s.trigger }, animations: s.animations }));
        const builds = compileBuilds(all);
        const played = playOrder(all);
        for (let k = 0; k <= builds.clicks; k++) expect([...reduceBuild(builds, k).hidden].sort()).toEqual(oracleHidden(played, k));
      }),
    );
  });
});

const TARGETS = ['a', 'b', 'c', 'd'];
const TRIGGER = fc.constantFrom('onEnter', 'onClick', 'withPrevious', 'afterPrevious', 'onEvent', 'onTime');
const ANIMATION = fc.record({ effect: fc.constantFrom('appear', 'disappear', 'fade-in'), targets: fc.subarray(TARGETS, { minLength: 1 }) });
type Played = { readonly step: BuildStep; readonly group: number };

/** The steps in the order they play, each with its group, counted by walking the list one step at a time (the oracle's own count, not the compiler's). */
function playOrder(all: readonly BuildStep[]): Played[] {
  let click = 0;
  const placed = all.map((step, i) => {
    const kind = step.trigger.kind;
    const group = kind === 'onEnter' ? 0 : kind === 'withPrevious' || kind === 'afterPrevious' ? click : ++click;
    return { step, group, i };
  });
  return placed.sort((x, y) => x.group - y.group || x.i - y.i);
}

/** The elements hidden after group `k`: the latest effect on each decides, and one whose first effect is `appear` starts hidden. */
function oracleHidden(played: readonly Played[], k: number): string[] {
  const effects = played.flatMap(({ step, group }) => step.animations.filter((a) => a.effect !== 'fade-in').map((a) => ({ a, group })));
  const hidden = new Set<string>();
  for (const t of TARGETS) if (effects.find(({ a }) => a.targets.includes(t))?.a.effect === 'appear') hidden.add(t);
  for (const { a, group } of effects.filter((e) => e.group <= k)) for (const t of a.targets) a.effect === 'appear' ? hidden.delete(t) : hidden.add(t);
  return [...hidden].sort();
}
