// NFR-PORT-001: the nightly runs the e2e suite on the Playwright release before the pinned one (scripts/ci/previous-playwright.mjs, M11.23).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { olderThan, PREVIOUS, pinPrevious, pinsOf } from '../../scripts/ci/previous-playwright.mjs';
import { REPO } from './helpers.mjs';

const CATALOG = `catalog:
  vitest: 5.0.2
  "@vitest/browser-playwright": 5.0.2
  playwright: 1.63.0
  fast-check: 4.10.2
  "@playwright/test": 1.63.0 # the runner
  "@axe-core/playwright": 4.13.0
`;

describe('previous-playwright (NFR-PORT-001)', () => {
  it('NFR-PORT-001: only the playwright and @playwright/test pins change, comments stay, and a second run changes nothing', () => {
    const out = pinPrevious(CATALOG, '1.62.1');
    assert.deepEqual(pinsOf(out), ['1.62.1', '1.62.1']);
    assert.equal(out.replace(/1\.62\.1/g, '1.63.0'), CATALOG);
    assert.match(out, /"@playwright\/test": 1\.62\.1 # the runner/);
    assert.match(out, /"@vitest\/browser-playwright": 5\.0\.2/);
    assert.equal(pinPrevious(out, '1.62.1'), out);
  });

  it("NFR-PORT-001: the previous release is older than the repository's pins, which --check reports without writing, and olderThan compares dotted numbers", () => {
    const check = spawnSync('node', ['scripts/ci/previous-playwright.mjs', '--check'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, new RegExp(`-> ${PREVIOUS.replaceAll('.', '\\.')} \\(check only\\)`));
    assert.equal(olderThan('1.62.1', '1.63.0'), true);
    assert.equal(olderThan('1.63.0', '1.63.0'), false);
    assert.equal(olderThan('2.0.0', '1.99.9'), false);
    assert.equal(olderThan('1.9.0', '1.10.0'), true);
  });
});
