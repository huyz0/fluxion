// HARNESS FR-LIB-007, FR-LIB-009: m18-complete's library search leg runs the suite that holds the case (M18.244, cp36 F3).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const SUITE = 'apps/studio/src/pack-catalog.test.ts';
const LEG = 'all first-party packs searchable within library search budget';
const CASE =
  'pack catalog > FR-LIB-001, FR-LIB-007: searching the complete first-party index finds the cylinder and the database icons under LIBRARY_SEARCH_10K_MAX_MS';

function fixture({ suite = true } = {}) {
  const sb = sandbox(['scripts/gates/m18-complete.mjs']);
  if (suite) sb.write(SUITE, '// Runner-port probe; the actual suite runs separately.');
  sb.write('scripts/gates/thresholds.mjs', 'export const t = () => 1;');
  sb.write(
    'scripts/gates/milestone-checks.mjs',
    'export const backlogTextFor=()=>"", benchUnder=()=>true, changesetsCoverRange=()=>true, checkBacklogDone=()=>true, checkFinalReview=()=>true, imageRunner=()=>null, loadMilestoneReviews=()=>[], namedCases=()=>true, playwrightSpecs=()=>true, verifyLeg=()=>true;',
  );
  sb.write(
    'scripts/gates/lib.mjs',
    `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const currentMilestone=()=> 'M18', exists=(p)=>existsSync(p), repoPath=(...p)=>join(process.cwd(),...p), readText=()=>'', node=()=>({status:0,stdout:'',stderr:''});
const legs=[];
export const leg=(name,fn)=>legs.push({name,fn});
export function run(command,args) {
  appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
  const names=JSON.parse(process.env.PROBE_CASES);
  const report={numFailedTestSuites:0,testResults:[{assertionResults:names.map((fullName)=>({status:'passed',fullName}))}]};
  writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length),JSON.stringify(report));
  return {status:0,stdout:'',stderr:''};
}
export async function runLegs() {
  const l=legs.find(l=>l.name===${JSON.stringify(LEG)});
  const result=l ? l.fn() : 'no leg';
  console.log(JSON.stringify(result));
  process.exitCode=result===true?0:1;
}
`,
  );
  return sb;
}
const probe = (sb, cases) => sb.node('scripts/gates/m18-complete.mjs', [], { env: { ...process.env, PROBE_CASES: JSON.stringify(cases) } });

describe('m18-complete library search leg (M18.244, cp36 F3)', () => {
  it('runs the studio pack-catalog suite in node and passes when its full-index search case passed', () => {
    const sb = fixture();
    try {
      const r = probe(sb, [CASE, 'the first-party packs in the studio library (M18.32) FR-LIB-009: ensure reads only the picked definition category']);
      assert.equal(r.status, 0, out(r));
      const [args] = readFileSync(sb.path('calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(args.at(-1), SUITE);
      assert.equal(args[args.indexOf('--project') + 1], 'node');
    } finally {
      sb.cleanup();
    }
  });
  it('fails when the suite passes without the case the leg names', () => {
    const sb = fixture();
    try {
      const r = probe(sb, ['the first-party packs in the studio library (M18.32) FR-LIB-009: ensure reads only the picked definition category']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, /no passed case named 'searching the complete first-party index'/);
    } finally {
      sb.cleanup();
    }
  });
  it('fails when the named suite is missing', () => {
    const sb = fixture({ suite: false });
    try {
      const r = probe(sb, [CASE]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, /missing apps\/studio\/src\/pack-catalog\.test\.ts/);
    } finally {
      sb.cleanup();
    }
  });
});
