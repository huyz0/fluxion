// NFR-MNT-006 / ADR-0014 §Commands: production code writes only inside a command's run (through the
// CommandContext's store), or in core's history and fork modules. A harness test, not a Vitest one:
// importing every source as raw text through Vite would make coverage skip untested files (M3.17).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { REPO, sandbox } from './helpers.mjs';

/** The modules ADR-0014 allows to call transact directly. */
const ALLOWED = new Set(['packages/core/src/history.ts', 'packages/core/src/fork.ts']);
// any call of transact: through a member, destructured, or by computed key (M3.17 review F3)
const CALL = /\btransact\s*\(|\[\s*['"`]transact['"`]\s*\]\s*\(/;
const THROUGH_COMMAND = /\bctx\.store\.transact\s*\(/;

/** Shipped source files under packages/*\/src, packs/*\/src and apps/*\/src of `root`. */
function sources(root = REPO) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.tsbuild', '__fixtures__'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories|bench)\.tsx?$/.test(name)) out.push(relative(root, full).split('\\').join('/'));
    }
  };
  // apps too: a studio quick fix must not write around the commands (M3 cp1 F6)
  for (const top of ['packages', 'packs', 'apps'])
    for (const pkg of existsSync(join(root, top)) ? readdirSync(join(root, top)) : [])
      if (existsSync(join(root, top, pkg, 'src'))) walk(join(root, top, pkg, 'src'));
  return out;
}

/** transact calls in `text` that are not made through a command context: [line, text]. */
const strayCalls = (text) => text.split(/\r?\n/).flatMap((line, i) => (CALL.test(line) && !THROUGH_COMMAND.test(line) ? [[i + 1, line.trim()]] : []));

/** Stray transact calls in every shipped source of `root`, as "path:line: code". */
const strays = (root = REPO) =>
  sources(root)
    .filter((f) => !ALLOWED.has(f))
    .flatMap((f) => strayCalls(readFileSync(join(root, f), 'utf8')).map(([line, code]) => `${f}:${line}: ${code}`));

describe('architecture (ADR-0014 §Commands)', () => {
  it('NFR-MNT-006: no production code calls store.transact outside a command run', () => {
    const files = sources();
    assert.ok(files.includes('packages/core/src/builtin-commands.ts'));
    assert.ok(files.some((f) => f.startsWith('packages/render/src/')));
    assert.ok(files.some((f) => f.startsWith('apps/studio/src/')));
    assert.deepEqual(strays(), []);
    // the built-ins do write, through their context
    assert.match(readFileSync(join(REPO, 'packages/core/src/builtin-commands.ts'), 'utf8'), THROUGH_COMMAND);
  });

  it('a direct write in an app fails', () => {
    const sb = sandbox(['apps/studio/src', 'packages/core/src']);
    try {
      sb.write('apps/studio/src/quick-fix.ts', "export const fix = (store: { transact: Function }) => store.transact('x', () => {});\n");
      assert.deepEqual(strays(sb.dir), [
        "apps/studio/src/quick-fix.ts:1: export const fix = (store: { transact: Function }) => store.transact('x', () => {});",
      ]);
    } finally {
      sb.cleanup();
    }
  });

  it('the check notices a direct write', () => {
    assert.equal(strayCalls("store.transact('x', (tx) => tx.delete(id));").length, 1);
    assert.deepEqual(strayCalls("this.#store.transact('x', f);\nctx.store.transact('y', g);"), [[1, "this.#store.transact('x', f);"]]);
    assert.equal(strayCalls("const { transact } = store;\ntransact('x', f);").length, 1);
    assert.equal(strayCalls("store['transact']('x', f);").length, 1);
  });
});
