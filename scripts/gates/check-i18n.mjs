#!/usr/bin/env node
// i18n gate (NFR-I18N-001; ADR-0023, ADR-0159): no text meant for people sits in JSX as a string literal. Every `.tsx` of the
// packages with UI is parsed (oxc-parser; TypeScript 7 ships no compiler API) and these fail:
//   a JSX text child that has a letter, outside a `<Trans>` (the macro takes its children as the message),
//   a string literal (or a template) as the value of `aria-label`, `aria-description`, `aria-roledescription`, `aria-placeholder`, `aria-valuetext`,
// `title`, `placeholder`, `alt` or `label`, or in a JSX child expression, in either branch of `?:` and in the operands of `&&`, `||` and `??`.
// Text that is purely symbols, digits or whitespace is exempt. `scripts/gates/i18n-allowlist.json` lists path globs (tests, stories,
// fixtures) and exact `{ file, text, reason }` entries; an entry that matches nothing is itself an error (it would hide a future literal).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'oxc-parser';
import { listFiles, repoPath } from './lib.mjs';

/** The sources checked: every package and app that draws UI text for people. The player's chrome strings are allowlisted until M11.72. */
export const ROOTS = ['packages/editor/src', 'packages/player/src', 'packages/render/src', 'apps/studio/src'];

const ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);
const TSX = /\.tsx$/;
const LETTER = /\p{L}/u;
/** An HTML entity in JSX text (`&times;`, `&nbsp;`): a glyph, not words. */
const ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi;

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*')}$`,
  );

/** The child nodes of an ESTree/JSX node (any object-valued property that is a node, or a list of them). */
function* children(node) {
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) yield* value.filter((v) => v !== null && typeof v === 'object');
    else if (value !== null && typeof value === 'object') yield value;
  }
}

/** Walk an ESTree/JSX node depth first, calling `visit(node, parent)`; `visit` returns false to skip the subtree. */
function walk(node, visit, parent = null) {
  const own = typeof node.type === 'string';
  if (own && visit(node, parent) === false) return;
  for (const child of children(node)) walk(child, visit, own ? node : parent);
}

const elementName = (opening) => (opening.name.type === 'JSXIdentifier' ? opening.name.name : '');
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

/** The string literals an expression can yield as text: itself, both branches of `?:`, and the operands of `&&`, `||` and `??` (calls, objects and arrow bodies are not followed). */
function* stringsOf(expr) {
  if (!expr) return;
  if (expr.type === 'Literal' && typeof expr.value === 'string') yield { node: expr, text: expr.value };
  else if (expr.type === 'TemplateLiteral') yield { node: expr, text: expr.quasis.map((q) => q.value.cooked ?? '').join('{}') };
  else if (expr.type === 'ConditionalExpression') yield* [...stringsOf(expr.consequent), ...stringsOf(expr.alternate)];
  else if (expr.type === 'LogicalExpression') yield* [...stringsOf(expr.left), ...stringsOf(expr.right)];
  else if (
    expr.type === 'ParenthesizedExpression' ||
    expr.type === 'TSAsExpression' ||
    expr.type === 'TSSatisfiesExpression' ||
    expr.type === 'TSNonNullExpression'
  )
    yield* stringsOf(expr.expression);
}

/** The text literals of an attribute listed in ATTRIBUTES: `title="x"`, `title={'x'}`, `title={a ? 'x' : 'y'}`. */
function* attributeTexts(attribute) {
  if (attribute.name.type !== 'JSXIdentifier' || !ATTRIBUTES.has(attribute.name.name) || !attribute.value) return;
  yield* stringsOf(attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value);
}

/** The text a node holds for people: a JSX text child, a string in an expression child (`{'Save'}`, `{ok ? 'Yes' : 'No'}`), or a text attribute. */
function* textsOf(node, parent) {
  if (node.type === 'JSXText') yield { node, text: node.value.replace(ENTITY, '') };
  else if (node.type === 'JSXAttribute') yield* attributeTexts(node);
  else if (node.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) yield* stringsOf(node.expression);
}

/**
 * The literals in one source file that are text for people: `{ line, text }` each.
 *
 * @param {string} file path (decides the language)
 * @param {string} source
 */
export function findLiterals(file, source) {
  const { program, errors } = parseSync(file, source, { lang: 'tsx' });
  if (errors.length > 0) throw new Error(`${file}: ${errors[0].message}`);
  const found = [];
  walk(program, (node, parent) => {
    if (node.type === 'JSXElement' && elementName(node.openingElement) === 'Trans') return false;
    for (const hit of textsOf(node, parent)) {
      if (LETTER.test(hit.text)) found.push({ line: lineOf(source, hit.node.start), text: hit.text.trim().replace(/\s+/g, ' ') });
    }
    return true;
  });
  return found;
}

/** The literals of one file that no allowlist entry covers, marking the entries used. */
function unlisted(file, source, entries) {
  const out = [];
  for (const lit of findLiterals(file, source)) {
    const entry = entries.find((e) => e.file === file && e.text === lit.text);
    if (entry) entry.used = true;
    else out.push(`${file}:${lit.line}: string literal in JSX outside a Lingui macro: "${lit.text}"`);
  }
  return out;
}

/**
 * Every literal outside the allowlist, and every allowlist entry that matched nothing.
 *
 * @param {{ files: string[], read?: (file: string) => string, allowlist: { globs?: string[], entries?: { file: string, text: string, reason: string }[] } }} input
 * @returns {string[]} problems, one line each
 */
export function checkI18n({ files, read = (f) => readFileSync(repoPath(f), 'utf8'), allowlist }) {
  const globs = (allowlist.globs ?? []).map(globToRegExp);
  const entries = (allowlist.entries ?? []).map((e) => ({ ...e, used: false }));
  const problems = entries.filter((e) => !e.reason?.trim()).map((e) => `allowlist entry ${e.file}: "${e.text}" has no reason`);
  for (const file of files.filter((f) => TSX.test(f) && !globs.some((g) => g.test(f)))) problems.push(...unlisted(file, read(file), entries));
  for (const e of entries.filter((x) => !x.used)) problems.push(`allowlist entry ${e.file}: "${e.text}" matches nothing (remove it)`);
  return problems;
}

function main() {
  const allowlist = JSON.parse(readFileSync(repoPath('scripts/gates/i18n-allowlist.json'), 'utf8'));
  const files = ROOTS.flatMap((root) => listFiles(root, (f) => TSX.test(f)));
  const problems = checkI18n({ files, allowlist });
  for (const p of problems) console.error(`i18n: ${p}`);
  if (problems.length === 0) console.log(`i18n: no string literal in the JSX of ${files.length} files`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
