// FR-EXT-001: extensible element kinds are looked up in registries; check-kind-switch fails on a
// switch or an if-chain on a kind in the packages that consume kinds.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

let sb;
const added = [];
const put = (path, text) => {
  sb.write(path, text);
  added.push(path);
};
const gate = () => sb.node('scripts/gates/check-kind-switch.mjs');

describe('check-kind-switch (FR-EXT-001)', () => {
  before(() => {
    sb = sandbox(['scripts', 'packages/core/src', 'packages/render/src', 'packages/routing/src', 'packages/schema/src', 'apps/studio/src']);
  });
  after(() => sb.cleanup());
  afterEach(() => {
    for (const p of added.splice(0)) sb.write(p, 'export {};\n');
  });

  it('passes on the real sources', () => {
    const r = gate();
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /no switch on a kind/);
  });

  it('switch on el.kind in render fails', () => {
    put(
      'packages/render/src/view.ts',
      "export function view(el: { kind: string }) {\n  switch (el.kind) {\n    case 'shape': return 1;\n  }\n  return 0;\n}\n",
    );
    const r = gate();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /packages\/render\/src\/view\.ts:2: switch on a kind/);
  });

  it('if-chain on connector kinds in routing fails (every consuming workspace is scanned; M3 cp1 F6)', () => {
    put(
      'packages/routing/src/route.ts',
      "export const r = (el: { kind: string }) => {\n  if (el.kind === 'connector') return 1;\n  else if (el.kind === 'shape') return 2;\n  return 0;\n};\n",
    );
    put('apps/studio/src/app-switch.ts', 'export const s = (el: { kind: string }) => {\n  switch (el.kind) {\n    default: return 0;\n  }\n};\n');
    // schema defines the kinds: its own dispatch is not scanned
    put('packages/schema/src/defines.ts', 'export const d = (el: { kind: string }) => {\n  switch (el.kind) {\n    default: return 0;\n  }\n};\n');
    const r = gate();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /packages\/routing\/src\/route\.ts:3: if-chain on a kind/);
    assert.match(r.stderr, /apps\/studio\/src\/app-switch\.ts:2: switch on a kind/);
    assert.doesNotMatch(r.stderr, /packages\/schema/);
  });

  it('an else-if chain on a kind fails; a bare switch (kind) too', () => {
    put(
      'packages/core/src/chain.ts',
      "export const f = (x: { kind: string }) => {\n  if (x.kind === 'a') return 1;\n  else if (x.kind === 'b') return 2;\n  return 0;\n};\n",
    );
    put('packages/render/src/bare.ts', 'export const g = (kind: string) => {\n  switch (kind) {\n    default: return 0;\n  }\n};\n');
    const r = gate();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /chain\.ts:3: if-chain on a kind/);
    assert.match(r.stderr, /bare\.ts:2: switch on a kind/);
  });

  it('early-return chains, ternary chains, reversed comparisons and indexed or called switch subjects fail (M3.15 review)', () => {
    const cases = {
      'packages/render/src/early.ts': [
        "export const d = (el: { kind: string }) => {\n  if (el.kind === 'shape') return 1;\n  if (el.kind === 'connector') return 2;\n  return 0;\n};\n",
        ':3: if-chain',
      ],
      'packages/render/src/ternary.ts': [
        "export const t = (el: { kind: string }) => (el.kind === 'shape' ? 1 : el.kind === 'text' ? 2 : 3);\n",
        ':1: if-chain',
      ],
      'packages/editor/src/reversed.ts': [
        "export const r = (el: { kind: string }) => {\n  if ('shape' === el.kind) return 1;\n  else if ('text' !== el.kind) return 2;\n  return 0;\n};\n",
        ':3: if-chain',
      ],
      'packages/editor/src/indexed.ts': [
        'export const i = (els: Array<{ kind: string }>, n: number) => {\n  switch (els[n].kind) {\n    default: return 0;\n  }\n};\n',
        ':2: switch',
      ],
      'packages/player/src/called.ts': [
        "export const c = (get: (id: string) => { kind: string }) => {\n  switch (get('a').kind) {\n    default: return 0;\n  }\n};\n",
        ':2: switch',
      ],
    };
    for (const [path, [text]] of Object.entries(cases)) put(path, text);
    const r = gate();
    assert.equal(r.status, 1, out(r));
    for (const [path, [, where]] of Object.entries(cases)) assert.ok(r.stderr.includes(`${path}${where}`), `${path}${where}\n${out(r)}`);
  });

  it('an else-if chain with long branch bodies and computed kind access fail (M3.15 review r2)', () => {
    const body = '    work();\n'.repeat(14);
    put(
      'packages/render/src/long.ts',
      `declare function work(): void;\nexport const l = (el: { kind: string }) => {\n  if (el.kind === 'shape') {\n${body}  } else if (el.kind === 'text') {\n${body}  }\n};\n`,
    );
    put('packages/editor/src/computed.ts', "export const k = (el: Record<string, string>) => {\n  switch (el['kind']) {\n    default: return 0;\n  }\n};\n");
    const r = gate();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /long\.ts:18: if-chain on a kind/);
    assert.match(r.stderr, /computed\.ts:2: switch on a kind/);
  });

  it('a single guard, or comparisons far apart, are not a chain', () => {
    put(
      'packages/render/src/guard.ts',
      `export const g = (el: { kind: string }) => {\n  if (el.kind === 'connector') return 1;\n${'  // …\n'.repeat(12)}  return el.kind === 'text' ? 2 : 0;\n};\n`,
    );
    const r = gate();
    assert.equal(r.status, 0, out(r));
  });

  it('comments, strings, tests and allow-listed lines do not count', () => {
    put(
      'packages/render/src/ok.ts',
      "// switch (el.kind) in a comment\nexport const s = 'switch (el.kind)';\nexport const p = (c: { kind: string }) => {\n  switch (c.kind) { // kind-switch-allow: path commands are a closed union\n    default: return 0;\n  }\n};\n",
    );
    put('packages/render/src/view.test.ts', 'switch (el.kind) {}\n');
    const r = gate();
    assert.equal(r.status, 0, out(r));
  });
});
