#!/usr/bin/env node
// Pre-commit gate: the staged diff must have a recorded `pass` verdict bound to its sha256.
// Bypass is impossible by design except through an explicit, reviewed exemption list below.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repoPath, stagedHash } from './lib.mjs';

const diff = git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean);
if (diff.length === 0) process.exit(0);

// Exemption: commits that only touch review/progress bookkeeping produced by the loop itself.
const BOOKKEEPING = [/^\.harness\/(progress\.md|state\.json|reviews\/)/, /^docs\/backlog\/current\.md$/];
if (diff.every((p) => BOOKKEEPING.some((re) => re.test(p)))) {
  console.log('reviewed: bookkeeping-only commit (exempt)');
  process.exit(0);
}

const hash = stagedHash();
const dir = repoPath('.harness', 'review');
const verdicts = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.startsWith(hash)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  : [];
if (verdicts.some((v) => v.verdict === 'pass' && v.diff_sha256 === hash)) {
  console.log(`reviewed: pass verdict found (${hash.slice(0, 12)})`);
  process.exit(0);
}
console.error(`reviewed: no pass verdict for staged diff ${hash.slice(0, 12)}.
Run the code-review skill: node scripts/harness/review.mjs context --task <ID> …
(Restaging after review changes the hash — review what you commit.)`);
process.exit(1);
