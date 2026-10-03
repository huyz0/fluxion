// FR-THM-008 (ADR-0022): the Google Fonts hosts are named by the studio's fetch module and nowhere else: no library, pack or bundle
// of the player or the editor can ask Google for anything.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const HOSTS = /googleapis\.com|gstatic\.com/;

/** The files under `dir` that `keep` accepts, recursively. */
function files(dir, keep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.tsbuild') return [];
    return statSync(path).isDirectory() ? files(path, keep) : keep(path) ? [path] : [];
  });
}

const names = (paths) => paths.filter((p) => HOSTS.test(readFileSync(p, 'utf8'))).map((p) => p.slice(REPO.length + 1).replaceAll('\\', '/'));

describe('Google Fonts hosts (FR-THM-008)', () => {
  it('FR-THM-008: the player bundle names no Google Fonts URL', () => {
    const player = join(REPO, 'packages', 'player');
    const bundle = files(join(player, 'dist'), (p) => /\.(js|mjs|cjs|css|html)$/.test(p));
    // the built player, when there is one, and the sources of the player and everything it is built from
    const sources = ['player', 'render', 'core', 'schema', 'theme', 'anim', 'format', 'geometry', 'layout', 'routing', 'dsl'].flatMap((pkg) =>
      files(join(REPO, 'packages', pkg, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.(test|stories)\.tsx?$/.test(p) && !p.includes(`${join('src', 'e2e')}`)),
    );
    assert.deepEqual(names([...bundle, ...sources]), []);
  });

  it('FR-THM-008: only the studio names them, among the sources of every package, pack and app', () => {
    const sources = ['packages', 'packs', 'apps'].flatMap((group) =>
      readdirSync(join(REPO, group)).flatMap((name) =>
        files(join(REPO, group, name, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.(test|stories)\.tsx?$/.test(p) && !p.includes(`${join('src', 'e2e')}`)),
      ),
    );
    assert.deepEqual(names(sources), ['apps/studio/src/google-fonts.ts']);
  });
});
