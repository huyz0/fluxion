// M19.57: a pull request's firefox and webkit e2e legs leave the fidelity, parity and axe scans to chromium;
// main's push runs and the nightly keep them on every engine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const read = (path) => readFileSync(join(REPO, path), 'utf8');
const SCANS = [
  'e2e/file.fidelity.spec.ts',
  'e2e/parity.edit-vs-present.spec.ts',
  'e2e/a11y.editor.spec.ts',
  'e2e/a11y.editor-shell.spec.ts',
  'e2e/a11y.player.spec.ts',
];

describe('pull requests run the scans on chromium only (M19.57)', () => {
  it('NFR-DX-001: only a pull request leg on another engine than chromium sets the switch; push and the nightly never do', () => {
    const e2e = /^ {2}e2e:\n[\s\S]*?(?=^ {2}\S)/m.exec(read('.github/workflows/ci.yml'))?.[0] ?? '';
    assert.match(
      e2e,
      /\n {10}FLUXION_E2E_SCANS_CHROMIUM_ONLY: \$\{\{ github\.event_name == 'pull_request' && matrix\.browser != 'chromium' && '1' \|\| '' \}\}\n/,
    );
    for (const wf of ['ci.yml', 'nightly.yml', 'gates.yml'])
      assert.equal(read(`.github/workflows/${wf}`).match(/FLUXION_E2E_SCANS_CHROMIUM_ONLY/g)?.length ?? 0, wf === 'ci.yml' ? 1 : 0, wf);
  });

  it('NFR-A11Y-001: with the switch, firefox lists none of the scan specs and axe is not run; without it, every scan spec is listed', () => {
    const list = (env) => {
      const r = spawnSync('pnpm', ['-s', 'exec', 'playwright', 'test', '--list', '--project=firefox', ...SCANS], {
        cwd: REPO,
        encoding: 'utf8',
        env: { ...process.env, FLUXION_E2E_SCANS_CHROMIUM_ONLY: env },
        shell: process.platform === 'win32',
      });
      return `${r.stdout}${r.stderr}`;
    };
    const off = list('');
    for (const spec of SCANS) assert.match(off, new RegExp(spec.slice(4).replaceAll('.', '\\.')), spec);
    const on = list('1');
    for (const spec of SCANS) assert.doesNotMatch(on, new RegExp(spec.slice(4).replaceAll('.', '\\.')), spec);
    // axe also runs inside other specs (expectAccessible): the fixture returns before analyze under the switch
    assert.match(
      read('e2e/test.ts'),
      /await use\(async \(\) => \{\n[^\n]*\n {6}if \(process\.env\['FLUXION_E2E_SCANS_CHROMIUM_ONLY'\] === '1'\) return;\n {6}const \{ violations \} = await new AxeBuilder/,
    );
  });
});
