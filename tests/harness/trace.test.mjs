// NFR-MNT-008: requirements are traceable to tests (IDs in titles) and to backlog rows.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

let sb;
const trace = (...args) => sb.node('scripts/gates/check-trace.mjs', args);
const nodeTest = (titles) => `import { describe, it } from 'node:test';\n${titles.map((t) => `it('${t}', () => {});`).join('\n')}\n`;

describe('check-trace (NFR-MNT-008)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts', 'docs/requirements', 'docs/backlog']);
    // no tests are copied: the generated Tests column starts empty, as check-trace --write would leave it
    sb.edit('docs/requirements/40-traceability.md', (t) =>
      t
        .split('\n')
        .map((line) => {
          const cells = line.split('|');
          if (!/^ (FR|NFR)-/.test(cells[1] ?? '')) return line;
          cells[6] = ' — ';
          return cells.join('|');
        })
        .join('\n'),
    );
  });
  afterEach(() => sb.cleanup());

  it('passes on the real requirements and backlog with no tests', () => {
    const r = trace();
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /338 requirements/);
  });

  const unknown = {
    'a node:test title': ['tests/harness/x.test.mjs', nodeTest(['FR-DOC-999: nope'])],
    'a vitest title': ['packages/core/src/a.test.ts', "import { it } from 'vitest';\nit('NFR-MNT-999 does not exist', () => {});\n"],
    'a Playwright describe title': ['e2e/a.spec.ts', "import { test } from '@playwright/test';\ntest.describe('FR-ZZZ-001 flows', () => {});\n"],
  };
  for (const [where, [path, text]] of Object.entries(unknown)) {
    it(`fails naming an unknown ID cited in ${where}`, () => {
      sb.write(path, text);
      const r = trace();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, new RegExp(`${path.replace(/[./]/g, '\\$&')}: test title cites unknown requirement (FR|NFR)-[A-Z]+-\\d{3}`));
    });
  }

  it('does not count commented-out tests or calls inside fixture strings (M1.13 review F1)', () => {
    sb.write(
      'tests/harness/c.test.mjs',
      "import { it } from 'node:test';\n// it('NFR-MNT-008 commented out', () => {});\n/* it('NFR-DX-003 in a block', () => {}); */\nconst fixture = \"it('NFR-DX-004 fixture', () => {})\";\nit('helper', () => fixture);\n",
    );
    const r = trace('--milestone', 'M0');
    assert.equal(r.status, 1, out(r));
    for (const id of ['NFR-MNT-008', 'NFR-DX-003', 'NFR-DX-004']) assert.match(r.stderr, new RegExp(`${id} \\(Must, milestone M0\\) has no test`));
  });

  it('a skipped or todo test does not cover a Must ID (M1.25, M1 cp2 F1)', () => {
    sb.write(
      'tests/harness/s.test.mjs',
      "import { describe, it } from 'node:test';\nit('NFR-MNT-008 skipped', { skip: true }, () => {});\nit('NFR-DX-003 todo', { todo: true });\ndescribe.skip('suite', () => {\n  it('NFR-DX-004 inside a skipped suite', () => {});\n});\n",
    );
    const r = trace('--milestone', 'M0');
    assert.equal(r.status, 1, out(r));
    for (const id of ['NFR-MNT-008', 'NFR-DX-003', 'NFR-DX-004']) assert.match(r.stderr, new RegExp(`${id} \\(Must, milestone M0\\) has no test`));
  });

  it('reads .each titles with nested args or a tagged template (M1.13 review F2)', () => {
    sb.write(
      'packages/core/src/e.test.ts',
      "import { it } from 'vitest';\nit.each(Object.entries(cases))('FR-DOC-998 %s', () => {});\nit.each`a | b`('FR-DOC-997 $a', () => {});\n",
    );
    const r = trace();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /unknown requirement FR-DOC-998/);
    assert.match(r.stderr, /unknown requirement FR-DOC-997/);
  });

  it('fails when the summary has no row for an increment (M1.13 review F4)', () => {
    sb.edit('docs/requirements/40-traceability.md', (t) => t.replace(/^\| R8 \|.*\n/m, ''));
    const r = trace();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /summary has no row for increment R8/);
  });

  it('fails when a milestone Must requirement has no test, naming the ID', () => {
    const r = trace('--milestone', 'M0');
    assert.equal(r.status, 1, out(r));
    for (const id of ['NFR-MNT-008', 'NFR-DX-003', 'NFR-DX-004']) assert.match(r.stderr, new RegExp(`${id} \\(Must, milestone M0\\) has no test`));
  });

  it('passes the milestone once every Must ID is named, in a test or an enclosing describe', () => {
    sb.write('tests/harness/a.test.mjs', nodeTest(['NFR-MNT-008: traced', 'NFR-DX-003 and NFR-DX-004 together']));
    sb.write('packages/core/src/b.test.ts', "import { describe } from 'vitest';\ndescribe('NFR-MNT-008 suite', () => {});\n");
    const r = trace('--milestone', 'M0', '--write');
    assert.equal(r.status, 0, out(r));
  });

  it('checks an increment (--increment R8), including area codes with digits', () => {
    const r = trace('--increment', 'R8');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /FR-TXT-006 \(Must, increment R8\)/);
    assert.match(r.stderr, /NFR-I18N-003 \(Must, increment R8\)/);
    sb.write('packages/format/src/i18n.test.ts', "import { it } from 'vitest';\nit('FR-TXT-006 NFR-I18N-003: any script', () => {});\n");
    assert.equal(trace('--increment', 'R8', '--write').status, 0);
  });

  it('fails when a backlog row cites an unknown ID or none', () => {
    // own rows, so the case does not depend on which milestone the live backlog holds
    sb.edit(
      'docs/backlog/current.md',
      (t) => `${t.trimEnd()}\n| M9.1 | x | NFR-MNT-998 | x | — | todo | |\n| M9.2 | x | all | x | — | todo | |\n| M9.3 | x | HARNESS | x | — | todo | |\n`,
    );
    const r = trace();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /backlog M9\.1: cites unknown requirement NFR-MNT-998/);
    assert.match(r.stderr, /backlog M9\.2: Req cell cites no requirement ID/);
    assert.doesNotMatch(r.stderr, /backlog M9\.3/);
  });

  it('fails when the matrix drifts from the requirement files', () => {
    sb.edit('docs/requirements/10-document-and-file.md', (t) => t.replace('| FR-DOC-006 | M | R1 |', '| FR-DOC-006 | S | R1 |'));
    const r = trace();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /FR-DOC-006: matrix says M\/R1, 10-document-and-file\.md says S\/R1/);
    assert.match(r.stderr, /summary R1: says 84\/7\/0\/91, requirement files give 83\/8\/0\/91/);
  });

  it('fails when the generated Tests column is stale (M1 cp3 F5)', () => {
    sb.write('tests/harness/a.test.mjs', nodeTest(['NFR-MNT-008: traced']));
    const r = trace();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /Tests column is stale for NFR-MNT-008: run check-trace.mjs --write/);
  });

  it('--write fills the Tests column from test titles', () => {
    sb.write('tests/harness/a.test.mjs', nodeTest(['NFR-MNT-008: traced']));
    assert.equal(trace('--write').status, 0);
    assert.match(sb.read('docs/requirements/40-traceability.md'), /\| NFR-MNT-008 \| M \| R0 \| M0 \| .* \| `tests\/harness\/a\.test\.mjs` \|/);
  });
});
