// FR-AI-011 (M19.61): the ladder's docs step checks what the docs build emits, llms.txt and llms-full.txt with the authoring guide.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { docsOutputProblem, LLMS, LLMS_FULL } from '../../scripts/gates/docs-output.mjs';

describe('the docs build output (FR-AI-011)', () => {
  it('FR-AI-011: the build output holds llms.txt and llms-full.txt with the guide in the full one', () => {
    const files = (entries) => (path) => entries[path];
    assert.equal(docsOutputProblem(files({ [LLMS]: 'x', [LLMS_FULL]: '# Authoring guide for AI\n' })), '');
    assert.match(docsOutputProblem(files({ [LLMS_FULL]: 'Authoring guide for AI' })), /emitted no apps\/docs\/dist\/llms\.txt/);
    assert.match(docsOutputProblem(files({ [LLMS]: 'x' })), /emitted no apps\/docs\/dist\/llms-full\.txt/);
    assert.match(docsOutputProblem(files({ [LLMS]: 'x', [LLMS_FULL]: 'no guide here' })), /lacks the authoring guide/);
  });
});
