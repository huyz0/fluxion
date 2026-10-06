// NFR-I18N-001: UI text is a Lingui message (ADR-0023): the macro transform, the catalog extraction and the gate that finds a literal.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkI18n, findLiterals } from '../../scripts/gates/check-i18n.mjs';
import { catalogDiff, extractCatalog, renderCatalog } from '../../scripts/i18n/extract.mjs';
import { catalogModule, compileCatalog, lingui } from '../../tools/vite-lingui/index.mjs';

const MACRO_SOURCE = `import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
export const greet = (name: string) => t\`Hello \${name}\`;
export const View = () => <p><Trans>Read <b>docs</b> now</Trans></p>;
`;

describe('check-i18n (NFR-I18N-001)', () => {
  const run = (source, allowlist = {}) => checkI18n({ files: ['packages/editor/src/x.tsx'], read: () => source, allowlist });

  it('NFR-I18N-001: a JSX string literal outside the allowlist fails check-i18n', () => {
    const problems = run('export const A = () => <button aria-label="Save">Save the file</button>;');
    assert.equal(problems.length, 2);
    assert.match(problems.join('\n'), /packages\/editor\/src\/x\.tsx:1: string literal in JSX outside a Lingui macro: "Save"/);
    assert.match(problems.join('\n'), /"Save the file"/);
  });

  it('NFR-I18N-001: a plain string in an expression container or a template without placeholders fails too', () => {
    assert.equal(run('export const A = () => <input placeholder={\'Name\'} title={`Rename`} alt="Logo" />;').length, 3);
  });

  it('NFR-I18N-001: a string in a JSX child expression, in a ternary branch or after && fails too, and so do the aria description attributes', () => {
    const source = `export const A = (p) => (
  <p title={p.x ? 'Open it' : 'Close it'} aria-description="Hint text">
    {'Hello world'}
    {p.x ? 'Yes please' : 'No thanks'}
    {p.x && 'Shown only when set'}
    {p.name ?? 'Unnamed item'}
  </p>
);`;
    assert.deepEqual(
      findLiterals('a.tsx', source).map((l) => l.text),
      ['Open it', 'Close it', 'Hint text', 'Hello world', 'Yes please', 'No thanks', 'Shown only when set', 'Unnamed item'],
    );
  });

  it('NFR-I18N-001: a template with substitutions fails, and an HTML entity alone is a glyph that passes', () => {
    assert.deepEqual(
      findLiterals('a.tsx', 'const a = <p>{`Hello ${n}`}{x!}{"Hi there"!}</p>;').map((l) => l.text),
      ['Hello {}', 'Hi there'],
    );
    assert.deepEqual(findLiterals('a.tsx', 'const a = <p>&times; &nbsp; &#8594;</p>;'), []);
    assert.deepEqual(
      findLiterals('a.tsx', 'const a = <p>&times; Close</p>;').map((l) => l.text),
      ['Close'],
    );
  });

  it('NFR-I18N-001: values that are not text for people pass: classes, keys, calls, and messages', () => {
    const source = `export const A = (p) => (
  <p className={p.x ? 'row wide' : 'row'} key={'k'} data-state={p.on && 'open'}>{p.count}{fmt(p.x, 'long')}{p.x ? '•' : '12'}{t\`Save\`}</p>
);`;
    assert.deepEqual(findLiterals('a.tsx', source), []);
  });

  it('NFR-I18N-001: text inside Trans, a message macro, symbols, digits and non-text attributes pass', () => {
    const source = `import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
export const A = () => <div className="row" data-testid="save" aria-label={t\`Save\`}><Trans>Save <b>now</b></Trans> • 12 {'→'} <span>×</span></div>;`;
    assert.deepEqual(run(source), []);
  });

  it('NFR-I18N-001: an allowlisted literal passes, a path glob skips a file, and a stale entry is an error', () => {
    const source = 'export const A = () => <code>sha256</code>;';
    assert.deepEqual(run(source, { entries: [{ file: 'packages/editor/src/x.tsx', text: 'sha256', reason: 'a hash name, not for people' }] }), []);
    assert.deepEqual(run(source, { globs: ['packages/editor/src/*.tsx'] }), []);
    const stale = run('export const A = () => <b />;', { entries: [{ file: 'packages/editor/src/x.tsx', text: 'gone', reason: 'r' }] });
    assert.match(stale[0], /matches nothing/);
    assert.match(run(source, { entries: [{ file: 'packages/editor/src/x.tsx', text: 'sha256', reason: ' ' }] })[0], /has no reason/);
  });

  it('NFR-I18N-001: findLiterals reports the line and normalises whitespace', () => {
    assert.deepEqual(findLiterals('a.tsx', 'const a = (\n  <p>\n    two   words\n  </p>\n);'), [{ line: 2, text: 'two words' }]);
  });
});

describe('extraction and catalogs (NFR-I18N-001)', () => {
  it('NFR-I18N-001: extractCatalog keys messages by id, sorted, with the files that use them', async () => {
    const read = async (file) => ({
      messages:
        file === 'b.tsx'
          ? [
              { id: 'b', message: 'Beta' },
              { id: 'a', message: 'Alpha' },
            ]
          : [{ id: 'a', message: 'Alpha' }],
    });
    const { catalog, errors } = await extractCatalog(['b.tsx', 'a.tsx'], { read });
    assert.deepEqual(errors, []);
    assert.deepEqual(Object.keys(catalog), ['a', 'b']);
    assert.deepEqual(catalog.a.origin, ['a.tsx', 'b.tsx']);
    assert.equal(renderCatalog(catalog).endsWith('}\n'), true);
  });

  it('NFR-I18N-001: one id with two texts is an error', async () => {
    const read = async (file) => ({ messages: [{ id: 'x', message: file }] });
    assert.match((await extractCatalog(['a.tsx', 'b.tsx'], { read })).errors[0], /two texts/);
  });

  it('NFR-I18N-001: catalogDiff names a new, a changed and a removed message', () => {
    const disk = { old: { message: 'Old' }, same: { message: 'S' }, changed: { message: 'Before' } };
    const src = { same: { message: 'S' }, changed: { message: 'After' }, fresh: { message: 'New' } };
    assert.deepEqual(catalogDiff(disk, src), ['~ changed  After', '+ fresh  New', '- old  Old']);
  });

  it('NFR-I18N-001: the native extractor finds the three macro forms in a source file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-i18n-'));
    try {
      writeFileSync(join(dir, 'm.tsx'), `${MACRO_SOURCE}export const label = msg\`Save\`;\n`.replace('import { t }', 'import { t, msg }'));
      const { extractMessagesFromFiles } = await import('@lingui/native-tools');
      const { messages } = await extractMessagesFromFiles([join(dir, 'm.tsx')]);
      assert.deepEqual(messages.map((m) => m.message).sort(), ['Hello {name}', 'Read <0>docs</0> now', 'Save']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Vite plugin (NFR-I18N-001)', () => {
  it('NFR-I18N-001: a module with a macro is compiled to runtime calls, any other module is left alone', async () => {
    const plugin = lingui();
    const out = await plugin.transform(MACRO_SOURCE, '/repo/packages/editor/src/x.tsx');
    assert.match(out.code, /\$_i18n\._\(/);
    assert.doesNotMatch(out.code, /@lingui\/core\/macro/);
    assert.equal(await plugin.transform('export const a = 1;', '/repo/a.ts'), null);
    assert.equal(await plugin.transform(MACRO_SOURCE, '/repo/node_modules/x/index.js'), null);
  });

  it('NFR-I18N-001: a production build keeps only the id of a message', async () => {
    const dev = await lingui({ production: false }).transform(MACRO_SOURCE, 'x.tsx');
    const prod = await lingui({ production: true }).transform(MACRO_SOURCE, 'x.tsx');
    assert.match(dev.code, /message: "Hello \{name\}"/);
    assert.doesNotMatch(prod.code, /message: "Hello/);
  });

  it('NFR-I18N-001: a catalog compiles to ICU tokens and a virtual module serves every locale', () => {
    assert.deepEqual(compileCatalog({ b: { message: 'Hello {name}' }, a: { message: 'Save' } }), { a: ['Save'], b: ['Hello ', ['name']] });
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-locales-'));
    try {
      mkdirSync(join(dir, 'en'));
      writeFileSync(join(dir, 'en', 'messages.json'), JSON.stringify({ k: { message: '{n, plural, one {# item} other {# items}}' } }));
      const plugin = lingui({ catalogs: { 'virtual:test-messages': dir } });
      const id = plugin.resolveId('virtual:test-messages');
      assert.equal(plugin.resolveId('other'), null);
      assert.match(plugin.load(id), /^export const catalogs = \{"en":\{"k":\[\["n","plural",\{"one":\["#"," item"\],"other":\["#"," items"\]\}\]\]\}\};/);
      assert.equal(catalogModule(dir), plugin.load(id));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
