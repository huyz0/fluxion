// NFR-MNT-006 / ADR-0014 §Commands: production code writes only inside a command's run (through the
// CommandContext's store), or in core's history and fork modules. A harness test, not a Vitest one:
// importing every source as raw text through Vite would make coverage skip untested files (M3.17).
// The check walks each file's syntax tree (M3 final F6, M4.6 review): a line pattern misses template
// expressions, aliases and scopes. Deliberate obfuscation (a key built from pieces at run time) is out
// of reach of any static check; the review covers it.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { REPO, sandbox } from './helpers.mjs';

// the compiler API comes from the repo's single TS 6 pin (ADR-0011): TS 7 ships none yet
const ts = createRequire(join(REPO, 'apps/docs/package.json'))('typescript');

/** The modules ADR-0014 allows to call transact directly. */
const ALLOWED = new Set(['packages/core/src/history.ts', 'packages/core/src/fork.ts']);
/** The module that declares transact: only its method declarations may name it there. */
const DECLARES = 'packages/core/src/store.ts';
/** Helpers taking a `CommandContext` that commands call to write, listed by module (the only ones). */
const HELPERS = { 'packages/core/src/builtin-commands.ts': ['write'] };

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

const isFunction = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
const nameOf = (n) => (n?.name && ts.isIdentifier(n.name) ? n.name.text : undefined);

/** Whether `fn` is the `run` of an object literal passed to `defineCommand(...)`. */
function isCommandRun(fn) {
  const prop = ts.isMethodDeclaration(fn) ? fn : ts.isPropertyAssignment(fn.parent) ? fn.parent : undefined;
  if (!prop || nameOf(prop) !== 'run' || !ts.isObjectLiteralExpression(prop.parent)) return false;
  const call = prop.parent.parent;
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'defineCommand';
}

/** Whether `fn` is a listed helper of `helpers` whose `ctx` parameter is typed `CommandContext`. */
function isListedHelper(fn, param, helpers) {
  const typed = param.type && ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName) && param.type.typeName.text === 'CommandContext';
  const holder = ts.isVariableDeclaration(fn.parent) ? fn.parent : fn;
  return Boolean(typed) && helpers.includes(nameOf(holder));
}

/** Whether a binding name (an identifier or a destructuring pattern) binds `ctx`. */
const bindsCtx = (name) =>
  name !== undefined && (ts.isIdentifier(name) ? name.text === 'ctx' : name.elements.some((e) => !ts.isOmittedExpression(e) && bindsCtx(e.name)));

/** Whether a variable declaration list binds `ctx`. */
const listBindsCtx = (list) => list !== undefined && ts.isVariableDeclarationList(list) && list.declarations.some((d) => bindsCtx(d.name));

/**
 * Whether scope node `n` binds `ctx` itself, closer than any parameter above it: a variable in a block
 * (destructuring included), a for / for-in / for-of initializer, or a catch variable (M4.6 review F2).
 */
function declaresCtx(n) {
  if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n))
    return n.statements.some((st) => ts.isVariableStatement(st) && listBindsCtx(st.declarationList));
  if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)) return listBindsCtx(n.initializer);
  if (ts.isCatchClause(n)) return bindsCtx(n.variableDeclaration?.name);
  return false;
}

/** Whether `fn` assigns to `ctx` anywhere in its body (a run that swaps its context for another). */
function assignsCtx(fn) {
  let found = false;
  const visit = (node) => {
    const op = ts.isBinaryExpression(node) ? node.operatorToken.kind : undefined;
    const assignment = op !== undefined && op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
    if (assignment && ts.isIdentifier(node.left) && node.left.text === 'ctx') found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

/**
 * Whether the `ctx` of a `ctx.store.transact(…)` at `node` is a command's: the nearest scope declaring
 * `ctx` is a parameter of a defineCommand `run`, or of a listed CommandContext helper.
 */
function commandContext(node, helpers) {
  for (let n = node.parent; n; n = n.parent) {
    if (isFunction(n)) {
      const param = n.parameters.find((p) => bindsCtx(p.name));
      // a destructured ctx is not the run's context; nor is one the run reassigns
      if (param) return ts.isIdentifier(param.name) && !assignsCtx(n) && (isCommandRun(n) || isListedHelper(n, param, helpers));
    }
    if (declaresCtx(n)) return false;
  }
  return false;
}

/** Whether the identifier `id` (named transact) is a command's write `ctx.store.transact(…)`. */
function isCommandWrite(id, helpers) {
  const access = id.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name !== id) return false;
  const store = access.expression;
  const direct = ts.isPropertyAccessExpression(store) && store.name.text === 'store' && ts.isIdentifier(store.expression) && store.expression.text === 'ctx';
  const called = ts.isCallExpression(access.parent) && access.parent.expression === access;
  return direct && called && commandContext(access.parent, helpers);
}

/** Whether `node` names transact without being a command's write (or, in `declares` mode, a method declaration). */
function isStray(node, declares, helpers) {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'transact') return true;
  if (!ts.isIdentifier(node) || node.text !== 'transact') return false;
  const declaration = declares && (ts.isMethodDeclaration(node.parent) || ts.isMethodSignature(node.parent)) && node.parent.name === node;
  return !declaration && !isCommandWrite(node, helpers);
}

/**
 * Mentions of transact in `text` that are not a command's write: [line, code]. Any identifier or
 * string named `transact` counts — a call, `.call`/`.apply`/`.bind`, an alias, a destructuring, a
 * computed or `Reflect` key, one inside a template expression — except a command's
 * `ctx.store.transact(…)` and, in `declares` mode, method declarations.
 */
function strayCalls(text, { declares = false, helpers = [], tsx = false } = {}) {
  // .ts parses as TS: in TSX a generic arrow `<R>(…) =>` reads as JSX and hides the code after it (M4.6
  // review F1); a file that does not parse cleanly fails loudly instead of passing unread
  const sf = ts.createSourceFile(tsx ? 'source.tsx' : 'source.ts', text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) throw new Error(`cannot parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, ' ')}`);
  const lines = text.split(/\r?\n/);
  const out = new Map();
  const report = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.set(line, lines[line - 1].trim());
  };
  const visit = (node) => {
    if (isStray(node, declares, helpers)) report(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...out];
}

/** Stray transact mentions in every shipped source of `root`, as "path:line: code". */
const strays = (root = REPO) =>
  sources(root)
    .filter((f) => !ALLOWED.has(f))
    .flatMap((f) =>
      strayCalls(readFileSync(join(root, f), 'utf8'), { declares: f === DECLARES, helpers: HELPERS[f] ?? [], tsx: f.endsWith('.tsx') }).map(
        ([line, code]) => `${f}:${line}: ${code}`,
      ),
    );

const RUN = (body) => `defineCommand({ id: 'x', run: (ctx, args) => ${body} });`;

describe('architecture (ADR-0014 §Commands)', () => {
  it('NFR-MNT-006: no production code calls store.transact outside a command run', () => {
    const files = sources();
    assert.ok(files.includes('packages/core/src/builtin-commands.ts'));
    assert.ok(files.some((f) => f.startsWith('packages/render/src/')));
    assert.ok(files.some((f) => f.startsWith('apps/studio/src/')));
    assert.deepEqual(strays(), []);
    // the built-ins do write, through their listed helper, and the check sees that code (M4.6 review
    // F1): the same file with a stray appended reports exactly that stray
    const builtins = readFileSync(join(REPO, 'packages/core/src/builtin-commands.ts'), 'utf8');
    assert.match(builtins, /\bctx\.store\.transact\s*\(/);
    const helpers = HELPERS['packages/core/src/builtin-commands.ts'];
    const appended = `${builtins.trimEnd()}\nexport const bad = (s) => s.transact('x', f);\n`;
    assert.deepEqual(strayCalls(appended, { helpers }), [[appended.split('\n').length - 1, "export const bad = (s) => s.transact('x', f);"]]);
    assert.equal(strayCalls(builtins, { helpers: [] }).length, 1, 'unlisted, the write helper is a stray');
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
    assert.deepEqual(strayCalls(`this.#store.transact('x', f);\n${RUN("ctx.store.transact('y', g)")}`), [[1, "this.#store.transact('x', f);"]]);
    assert.equal(strayCalls("const { transact } = store;\ntransact('x', f);").length, 2);
    assert.equal(strayCalls("store['transact']('x', f);").length, 1);
    // comments and strings that are not the name are not code
    assert.deepEqual(strayCalls("// store.transact('x', f)\nconst s = 'store.transact(1)';"), []);
    // but a template expression and code after a regex holding a backtick are (M4.6 review F1)
    assert.equal(strayCalls("const s = `${store.transact('x', f)}`;").length, 1);
    assert.equal(strayCalls("const r = /`/;\nstore.transact('x', f);\nconst t = `a`;").length, 1);
    // TS syntax that a TSX parse would misread: a generic arrow, an angle-bracket assertion (round 2 F1)
    assert.equal(strayCalls("const g = <T>(s: Store) => s.transact('x', h);").length, 1);
    assert.equal(strayCalls("const s = <Store>obj;\ns.transact('x', f);").length, 1);
    assert.throws(() => strayCalls('const = ;'), /cannot parse/);
  });

  // M3 final F6: the write path is not only the literal `transact(` call
  it('transact through call, apply or bind fails', () => {
    for (const code of [
      "store.transact.call(store, 'x', f);",
      "store.transact.apply(store, ['x', f]);",
      "const w = store.transact.bind(store);\nw('x', f);",
      'const w = store.transact;',
      'queue.push(store.transact);',
      "store.transact?.('x', f);",
      // string keys (M4.6 review F4)
      "Reflect.get(store, 'transact')('x', f);",
      "const k = 'transact';\nstore[k]('x', f);",
    ])
      assert.ok(strayCalls(code).length >= 1, code);
    // even on a command's context: only the call itself is the command's write
    assert.equal(strayCalls(RUN("ctx.store.transact.call(ctx.store, 'x', f)")).length, 1);
  });

  it('a ctx-named helper outside a command fails', () => {
    // a helper that names its parameter ctx is no command
    assert.equal(strayCalls("const helper = (ctx) => ctx.store.transact('x', f);").length, 1);
    assert.equal(strayCalls("function save(ctx: Session) {\n  return ctx.store.transact('x', f);\n}").length, 1);
    // a run of an object that is not a defineCommand argument is no command (M4.6 review F3)
    assert.equal(strayCalls("const x = { run: (ctx) => ctx.store.transact('x', f) };").length, 1);
    // a CommandContext-typed helper counts only when listed for its module (review F3)
    const helper = "const write = (ctx: CommandContext, fn) => ctx.store.transact('x', fn, ctx.options);";
    assert.equal(strayCalls(helper).length, 1);
    assert.deepEqual(strayCalls(helper, { helpers: ['write'] }), []);
    // scope: a closer `const ctx` hides a run's parameter above it (review F2)
    assert.equal(strayCalls(`${RUN('ok(1)')}\nfunction save(store) { const ctx = { store }; return ctx.store.transact('x', f); }`).length, 1);
    // a command's run writes: arrow, method, and a function nested in the run that reuses its ctx
    assert.deepEqual(strayCalls(RUN("ctx.store.transact('x', f)")), []);
    assert.deepEqual(strayCalls("defineCommand({ id: 'x', run(ctx, args) {\n  return ctx.store.transact('x', f);\n} });"), []);
    assert.deepEqual(strayCalls(RUN("[1].map(() => ctx.store.transact('x', f))")), []);
    // a run that shadows or swaps its ctx no longer writes through the command's context (round 2 F2)
    for (const body of [
      "{ const { ctx } = other; return ctx.store.transact('x', f); }",
      "{ for (const ctx of others) ctx.store.transact('x', f); }",
      "{ try { g(); } catch (ctx) { ctx.store.transact('x', f); } }",
      "{ ctx = { store: raw }; return ctx.store.transact('x', f); }",
    ])
      assert.equal(strayCalls(RUN(body)).length, 1, body);
  });

  it('the store module may only declare transact', () => {
    const decl = 'interface Store {\n  transact<R>(label: string, fn: (tx: Tx) => R): Result<R, TxFailure>;\n}';
    assert.deepEqual(strayCalls(decl, { declares: true }), []);
    // a call with a type argument is a call, not a declaration (M4.6 review F5)
    assert.equal(strayCalls(`${decl}\nclass S { foo() { return this.transact<void>('x', f); } }`, { declares: true }).length, 1);
    assert.equal(strayCalls(decl).length, 1);
  });
});
