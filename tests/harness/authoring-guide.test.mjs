// FR-AI-011 (M14.20): the authoring guide page is generated, current, and checked against the catalog and the code registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { catalogIds, demote, drift, render } from '../../scripts/docs/authoring-guide.mjs';
import { REPO } from './helpers.mjs';

describe('authoring guide generator (FR-AI-011)', () => {
  it('FR-AI-011: demote deepens headings outside code fences only', () => {
    assert.equal(demote('# A\n```\n# not a heading\n```\n## B'), '## A\n```\n# not a heading\n```\n### B');
  });

  it('FR-AI-011: the page holds the cheat sheet, the catalog, the example names and one example', () => {
    const text = render({ cheatSheet: '# Sheet\nbody', catalog: '# Cat\n`basic:rect`', examples: ['a.flux.yaml'], example: 'flux: 1' });
    assert.match(text, /^## Sheet$/m);
    assert.match(text, /^## Cat$/m);
    assert.match(text, /`a\.flux\.yaml`/);
    assert.match(text, /```yaml flux\nflux: 1\n```/);
    assert.deepEqual([...catalogIds(text)], ['basic:rect']);
  });

  it('FR-AI-011: a guide naming an id missing from the catalog, or an unknown code, is reported; known ones are not', () => {
    const known = { ids: new Set(['basic:rect']), packs: new Set(['basic']), codes: new Set(['FLX_REF_MISSING']) };
    assert.deepEqual(drift({ 'g.md': 'use `basic:rect` and `FLX_REF_MISSING`, see `https:foo`' }, known), []);
    assert.deepEqual(drift({ 'g.md': 'use `basic:gone`, `FLX_NOPE`' }, known), [
      'g.md: "basic:gone" is not in the catalog',
      'g.md: "FLX_NOPE" is not a diagnostic code',
    ]);
  });

  it('FR-AI-011: the written page is what the sources generate and the guides agree with it', () => {
    const check = spawnSync(process.execPath, [join(REPO, 'scripts/docs/authoring-guide.mjs'), '--check'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  });
});
