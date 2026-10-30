// M18.204 (cp28 F2; FR-AST-003, HARNESS): the completion leg named for the CLI font-subset option
// runs the built bin's --subset-fonts e2e, not only the pack import suite.
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const IMPORT = 'packages/cli/src/pack-import.test.ts';
const SUBSET = 'packages/cli/src/e2e/cli.subset-fonts.test.ts';
const LEG = 'CLI pack import and font-subset option exercise real files';
function fixture() {
  const sb = sandbox(['scripts/gates/m18-complete.mjs']);
  for (const file of [IMPORT, SUBSET]) sb.write(file, '// Runner-port probe; real suites execute separately.');
  sb.write('scripts/gates/thresholds.mjs', 'export const t=()=>1;');
  sb.write(
    'scripts/gates/milestone-checks.mjs',
    `
export const backlogTextFor=()=>'', benchUnder=()=>true, changesetsCoverRange=()=>true, checkBacklogDone=()=>true, checkFinalReview=()=>true, imageRunner=()=>null, loadMilestoneReviews=()=>[], namedCases=()=>true, verifyLeg=()=>true, playwrightSpecs=()=>true;
`,
  );
  sb.write(
    'scripts/gates/lib.mjs',
    `
import { appendFileSync,existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const currentMilestone=()=> 'M18', exists=(p)=>existsSync(p), repoPath=(...p)=>join(process.cwd(),...p), readText=()=>'', node=()=>({status:0,stdout:'',stderr:''});
const legs=[]; export const leg=(name,fn)=>legs.push({name,fn});
export function run(command,args) {
  if(command!=='pnpm') throw Error('unexpected runner');
  appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
  const failed=args.at(-1)===process.env.BAD_UNIT ? 1 : 0;
  writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length),JSON.stringify({numFailedTestSuites:failed,testResults:[{assertionResults:[{status:failed?'failed':'passed'}]}]}));
  return {status:failed,stdout:'',stderr:''};
}
export function runLegs() {
  const selected=legs.filter(l=>l.name===${JSON.stringify(LEG)});
  const results=selected.map(l=>{try{return l.fn();}catch(e){return e.message;}});
  console.log(JSON.stringify(results)); process.exitCode=results.length===1&&results.every(r=>r===true)?0:1;
}
`,
  );
  return sb;
}
const probe = (sb, extra = {}) => sb.node('scripts/gates/m18-complete.mjs', [], { env: { ...process.env, ...extra } });
const ran = (sb) =>
  readFileSync(sb.path('calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).at(-1));

describe('CLI font-subset completion leg (M18.204, FR-AST-003, HARNESS)', () => {
  it('runs the pack import suite and the --subset-fonts e2e', () => {
    const sb = fixture();
    try {
      const r = probe(sb);
      assert.equal(r.status, 0, out(r));
      assert.deepEqual(ran(sb), [IMPORT, SUBSET]);
    } finally {
      sb.cleanup();
    }
  });
  it('fails when the --subset-fonts e2e is absent or red', () => {
    const sb = fixture();
    try {
      let r = probe(sb, { BAD_UNIT: SUBSET });
      assert.equal(r.status, 1, out(r));
      rmSync(sb.path(SUBSET));
      r = probe(sb);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, /missing packages\/cli\/src\/e2e\/cli\.subset-fonts\.test\.ts/);
    } finally {
      sb.cleanup();
    }
  });
});
