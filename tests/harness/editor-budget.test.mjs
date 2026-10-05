// NFR-SIZE-002: the editor's initial bundle is at most EDITOR_INITIAL_GZIP gzip and its time to interactive at most EDITOR_TTI_MS on the reference desktop. The two are held by
// gates (size-limit and the Lighthouse CI job); this names the requirement and checks the gates read the thresholds and are wired in (M11.19).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import config from '../../.size-limit.js';
import lighthouse from '../../lighthouserc.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';
import { REPO } from './helpers.mjs';

describe('the editor budgets (NFR-SIZE-002)', () => {
  it('NFR-SIZE-002: size-limit holds the editor initial bundle to EDITOR_INITIAL_GZIP and Lighthouse its time to interactive to EDITOR_TTI_MS', () => {
    // 600 kB gzip and 2.5 s are the requirement's numbers: a threshold that moved would show here before it showed anywhere else
    assert.equal(t('EDITOR_INITIAL_GZIP'), 600_000);
    assert.equal(t('EDITOR_TTI_MS'), 2500);
    const editor = config.find((e) => e.name === 'editor initial');
    assert.ok(editor, 'a size-limit entry for the editor');
    assert.equal(editor.limit, `${Math.floor(t('EDITOR_INITIAL_GZIP') / 1000)} kB`);
    assert.equal(editor.gzip, true);
    const assertion = lighthouse.ci.assert.assertions.interactive;
    assert.equal(assertion[0], 'error');
    assert.equal(assertion[1].maxNumericValue, t('EDITOR_TTI_MS'));
    assert.equal(lighthouse.ci.collect.settings.preset, 'desktop');
    // the CI job runs it, and the evidence gate requires the job
    const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    assert.match(ci, /^ {2}lighthouse:/m);
    assert.match(readFileSync(join(REPO, 'scripts/gates/check-ci-evidence.mjs'), 'utf8'), /\['lighthouse'\]/);
  });
});
