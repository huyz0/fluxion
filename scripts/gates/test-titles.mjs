// Test titles in a JS/TS source file, read the way the runner would see them (NFR-MNT-008, NFR-DX-004).
// A call counts only in code: not inside a string, template text, comment or regex literal.
// `runs` is false for skip/todo in every form the runners accept: `.skip`, `.todo`, `.skipIf(…)`,
// `.runIf(…)` (conditional), Playwright `.fixme` (quarantine), `.fails`/`.fail` (expected to fail),
// `x`-prefixed calls, node:test/vitest `{ skip }`/`{ todo }`/`{ fails }` options, runtime skips,
// and an enclosing suite that does not run. Used by check-trace and check-tests-kept.

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return']);

/** Per-character flag: 1 where the character is code. */
export function codeMask(text) {
  const st = { i: 0, mode: 'code', quote: '', inClass: false, braces: [], last: '', mask: new Uint8Array(text.length) };
  while (st.i < text.length) STEP[st.mode](text, st);
  return st.mask;
}

const STEP = {
  code(text, st) {
    if (enterNonCode(text, st)) return;
    const ch = text[st.i];
    if (closesTemplateExpr(ch, st)) return;
    st.mask[st.i] = 1;
    if (!/\s/.test(ch)) st.last = /\w/.test(ch) ? lastWord(text, st.i) : ch;
    st.i++;
  },
  line(text, st) {
    if (text[st.i] === '\n') st.mode = 'code';
    st.i++;
  },
  block(text, st) {
    if (text.startsWith('*/', st.i)) {
      st.mode = 'code';
      st.i += 2;
    } else st.i++;
  },
  str(text, st) {
    const ch = text[st.i];
    if (ch === '\\') st.i += 2;
    else {
      if (ch === st.quote || ch === '\n') leave(st, '"');
      st.i++;
    }
  },
  tpl(text, st) {
    if (text[st.i] === '\\') st.i += 2;
    else if (text[st.i] === '`') {
      leave(st, '"');
      st.i++;
    } else if (text.startsWith('${', st.i)) {
      st.braces.push(0);
      st.mode = 'code';
      st.last = '{';
      st.i += 2;
    } else st.i++;
  },
  regex(text, st) {
    const ch = text[st.i];
    if (ch === '\\') st.i += 2;
    else {
      if (ch === '[') st.inClass = true;
      else if (ch === ']') st.inClass = false;
      else if ((ch === '/' && !st.inClass) || ch === '\n') leave(st, '"');
      st.i++;
    }
  },
};

function leave(st, last) {
  st.mode = 'code';
  st.last = last;
}

function lastWord(text, i) {
  let j = i;
  while (j >= 0 && /\w/.test(text[j])) j--;
  return text.slice(j + 1, i + 1);
}

function enterNonCode(text, st) {
  const ch = text[st.i];
  const next = text[st.i + 1];
  const to = (mode, step = 1) => {
    st.mode = mode;
    st.i += step;
    return true;
  };
  if (ch === '/' && next === '/') return to('line', 2);
  if (ch === '/' && next === '*') return to('block', 2);
  if (ch === "'" || ch === '"') {
    st.quote = ch;
    return to('str');
  }
  if (ch === '`') return to('tpl');
  if (ch === '/' && REGEX_AFTER.has(st.last)) {
    st.inClass = false;
    return to('regex');
  }
  return false;
}

// `}` that closes a `${ … }` returns to the enclosing template text
function closesTemplateExpr(ch, st) {
  const top = st.braces.length - 1;
  if (top < 0 || (ch !== '{' && ch !== '}')) return false;
  if (ch === '{') st.braces[top]++;
  else if (st.braces[top] > 0) st.braces[top]--;
  else {
    st.braces.pop();
    st.mode = 'tpl';
    st.i++;
    return true;
  }
  return false;
}

// [x]describe|it|test and a member chain whose links may take args or a tagged template; the title,
// a string literal or an expression (`it(c.name, …)`, shown as `<c.name>`); an options object (one
// level of nesting) or an options variable; the callback's context parameter, plain or destructured
const CALL =
  /(?<![.\w$])(x?(?:describe|it|test))((?:\.[a-zA-Z]+(?:\((?:[^()]|\([^()]*\))*\)|`[^`]*`)?)*)\s*\(\s*(?:(['"`])((?:\\.|(?!\3)[^\\])*)\3|([A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])?)(?=\s*[,)]))(\s*,\s*\{(?:[^{}]|\{[^{}]*\})*\})?(?:\s*,\s*([A-Za-z_$][\w$]*)(?=\s*,))?(?:\s*,\s*(?:async\s+)?(?:function\s*[\w$]*\s*)?(?:\(\s*\{([^}]*)\}|\(?\s*([A-Za-z_$][\w$]*)))?/g;
// not verifying: skipped, todo, conditional, quarantined (Playwright `fixme`, testing.md rule 19) or
// expected to fail (vitest `fails`, Playwright `fail`) (M1.25 review r2 F1; M1.29)
const SKIPPED_CHAIN = /\.(skip|todo|skipIf|runIf|fixme|fails|fail)\b/;
// `{ skip: true }`, `{ skip: cond }` and the shorthand `{ skip }`, but not `{ skip: false }`
const SKIPPED_OPTION = /\b(skip|todo|fails)\b(?!\s*:\s*false\b)/;
const FOCUSED = /\.only\b/;
const FOCUSED_OPTION = /\bonly\b(?!\s*:\s*false\b)/;
// options this scanner cannot read (a spread or a variable) might skip the test: assume they do,
// so the gates fail loudly rather than count an unknown test (M1.29 review F3)
const OPAQUE_OPTION = /\.\.\./;

// members a test/suite declaration may chain; anything else (`beforeEach`, `setTimeout`, `use`,
// `extend`, `configure`, …) is a hook or config call, not a test (M1.29 review r2 F2)
const MODIFIERS = new Set([
  'skip',
  'todo',
  'only',
  'skipIf',
  'runIf',
  'fixme',
  'fails',
  'fail',
  'concurrent',
  'sequential',
  'each',
  'for',
  'describe',
  'step',
  'serial',
  'parallel',
]);

/** 'it' | 'test' (a case), 'describe' (a suite), 'step' (Playwright, inside a case), or null. */
function kindOf(name, chain) {
  // the chain's own members, not names inside its arguments (`.each(Object.entries(x))`)
  const bare = chain.replace(/\((?:[^()]|\([^()]*\))*\)|`[^`]*`/g, '');
  const members = [...bare.matchAll(/\.([a-zA-Z]+)/g)].map((m) => m[1]);
  if (!members.every((m) => MODIFIERS.has(m))) return null;
  if (members.includes('step')) return 'step';
  if (members.includes('describe') || name.endsWith('describe')) return 'describe';
  return name.replace(/^x/, '');
}

function ownRuns(name, chain, options, optionsVar) {
  if (name.startsWith('x') || optionsVar) return false;
  return !SKIPPED_CHAIN.test(chain) && !SKIPPED_OPTION.test(options) && !OPAQUE_OPTION.test(options);
}

/**
 * Every describe/it/test title written in code: its kind, whether it runs, and whether it is
 * focused (`.only`). A test inside a suite that does not run does not run either.
 */
export function testTitles(text) {
  const mask = codeMask(text);
  const calls = [];
  const re = new RegExp(CALL.source, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // a match that starts inside a string or comment must not swallow the code after it
    if (mask[m.index] !== 1) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const [, name, chain, , literal, expr, options = '', optionsVar, destructured = '', ctx] = m;
    const kind = kindOf(name, chain);
    if (!kind) continue;
    // the call's argument list: from the paren after the member chain to its match, in code only
    const open = text.indexOf('(', m.index + name.length + chain.length);
    const end = closingParen(text, mask, open);
    // `test.skip(cond)` / `test.skip(cond, 'reason')` is a runtime skip, not a test declaration
    if (literal === undefined && SKIPPED_CHAIN.test(chain) && !secondArgIsCode(text, mask, open, end)) continue;
    calls.push({
      at: m.index,
      open,
      kind,
      title: literal ?? `<${expr}>`,
      own: ownRuns(name, chain, options, optionsVar),
      focused: FOCUSED.test(chain) || FOCUSED_OPTION.test(options),
      ctx: new Set([ctx, ...destructured.split(',').map((s) => s.trim())].filter(Boolean)),
      end,
    });
  }
  markRuntimeSkips(text, mask, calls);
  const skipped = calls.filter((c) => !c.own);
  return calls.map((c) => ({ kind: c.kind, title: c.title, focused: c.focused, runs: c.own && !skipped.some((s) => c.at > s.at && c.at < s.end) }));
}

// An untitled `.skip()`, `.todo()`, `.fixme()` or `.fail()` at run time skips the innermost test
// around it, even when conditional (like `skipIf`, it may not run). The receiver must be the runner
// (Playwright `test.skip(cond)`) or that test's own context parameter (node:test `t.skip()`, vitest
// `ctx.skip()`, or a destructured `({ skip }) => skip()`); `assert.fail()` or `iter.skip(2)` are
// not skips (M1.29). A runner skip outside any test applies to the whole file, as in Playwright.
const RUNTIME_SKIP = /(?<![.\w$])(?:([\w$]+)\.)?(skip|todo|fixme|fail)\s*\(\s*(['"`])?/g;
const RUNNERS = new Set(['it', 'test', 'describe']);
function markRuntimeSkips(text, mask, calls) {
  for (const m of text.matchAll(RUNTIME_SKIP)) {
    const [, receiver, method, quote] = m;
    const runner = RUNNERS.has(receiver);
    // part of a declaration's own member chain (`it.skip(c.name, fn)`), already read as a test
    const declaration = calls.some((c) => c.at <= m.index && m.index < c.open);
    if (mask[m.index] !== 1 || (runner && quote) || declaration) continue;
    // a bare call is a skip only when the test destructured it from its context
    for (const c of skippedBy(m.index, receiver ?? method, runner, calls)) c.own = false;
  }
}

// the calls a runtime skip at `at` affects: its innermost enclosing test, or the whole file
function skippedBy(at, receiver, runner, calls) {
  const around = calls.filter((c) => c.at < at && at < c.end).sort((a, b) => b.at - a.at)[0];
  if (!around) return runner ? calls : [];
  return runner || around.ctx.has(receiver) ? [around] : [];
}

// whether the call has a second argument that is code (a callback), not a string or nothing
function secondArgIsCode(text, mask, open, end) {
  let depth = 0;
  for (let i = open + 1; i < end; i++) {
    if (mask[i] !== 1) continue;
    if ('([{'.includes(text[i])) depth++;
    else if (')]}'.includes(text[i])) depth--;
    else if (text[i] === ',' && depth === 0) return /^\s*[^\s'"`]/.test(text.slice(i + 1, end));
  }
  return false;
}

function closingParen(text, mask, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (mask[i] !== 1) continue;
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}
