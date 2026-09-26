// Test titles in a JS/TS source file, read the way the runner would see them (NFR-MNT-008).
// A call counts only in code: not inside a string, template text, comment or regex literal.
// `runs` is false for skip/todo in every form the runners accept: `.skip`, `.todo`, `.skipIf(…)`,
// `.runIf(…)` (conditional), Playwright `.fixme` (quarantine), `.fails`/`.fail` (expected to fail),
// and node:test `{ skip }` / `{ todo }` options. `x`-prefixed calls
// (xit, xdescribe) never match. (M1 cp2 F1; M1.13 review minors.)

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

// describe|it|test, a member chain whose links may take args or a tagged template, then the title
const CALL =
  /(?<![.\w$])(describe|it|test)((?:\.[a-zA-Z]+(?:\((?:[^()]|\([^()]*\))*\)|`[^`]*`)?)*)\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3(\s*,\s*\{[^{}]*\})?/g;
// not verifying: skipped, todo, conditional, quarantined (Playwright `fixme`, testing.md rule 19) or
// expected to fail (vitest `fails`, Playwright `fail`) (M1.25 review r2 F1)
const SKIPPED_CHAIN = /\.(skip|todo|skipIf|runIf|fixme|fails|fail)\b/;
const SKIPPED_OPTION = /\b(skip|todo)\s*:(?!\s*false\b)/;

/**
 * Every describe/it/test title written in code, and whether that test or suite runs. A test inside
 * a skipped or todo suite does not run either (M1.25 review F1).
 */
export function testTitles(text) {
  const mask = codeMask(text);
  const calls = [];
  const re = new RegExp(CALL.source, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // a match that starts inside a string or comment must not swallow the code after it (r2 F2)
    if (mask[m.index] !== 1) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const [, name, chain, , title, options] = m;
    const own = !SKIPPED_CHAIN.test(chain) && !(options && SKIPPED_OPTION.test(options));
    // the call's argument list: from the paren after the member chain to its match, in code only
    const open = text.indexOf('(', m.index + name.length + chain.length);
    calls.push({ at: m.index, title, own, end: closingParen(text, mask, open) });
  }
  markRuntimeSkips(text, mask, calls);
  const skipped = calls.filter((c) => !c.own);
  return calls.map((c) => ({ title: c.title, runs: c.own && !skipped.some((s) => c.at > s.at && c.at < s.end) }));
}

// An untitled `.skip()`, `.todo()`, `.fixme()` or `.fail()` in a body (Playwright `test.skip()`,
// node:test `t.skip()`, vitest `ctx.skip()`) skips the innermost test around it, even when
// conditional: like `skipIf`, it may not run.
// A titled declaration (`it.skip('t', …)`) has a runner receiver and a string first; anything else,
// such as `t.todo('reason')` or `test.skip(cond, 'reason')`, is a skip at run time.
const RUNTIME_SKIP = /([\w$]+)\.(skip|todo|fixme|fail)\s*\(\s*(['"`])?/g;
const RUNNERS = new Set(['it', 'test', 'describe']);
function markRuntimeSkips(text, mask, calls) {
  for (const m of text.matchAll(RUNTIME_SKIP)) {
    if (mask[m.index] !== 1 || (RUNNERS.has(m[1]) && m[3])) continue;
    const around = calls.filter((c) => c.at < m.index && m.index < c.end).sort((a, b) => b.at - a.at)[0];
    if (around) around.own = false;
  }
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
