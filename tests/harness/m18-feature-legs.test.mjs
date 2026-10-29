import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const ART = 'packages/render/src/artwork-view.browser.test.tsx';
const LEGACY = 'packages/render/src/shape-view.browser.test.tsx';
const LOADER = 'packages/sdk/src/pack-loader.test.ts';
function fixture() {
  const sb = sandbox(['scripts/gates/m18-complete.mjs']);
  for (const file of [ART, LEGACY, LOADER]) sb.write(file, '// Runner-port probe; actual suites run separately.');
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
  if(command!=='pnpm') throw Error('unexpected runner');
  appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
  const mode=process.env.PROBE_MODE ?? 'passed';
  const selected=args.at(-1)===process.env.PROBE_FILE;
  const status=selected ? mode : 'passed';
  const named=status==='named-failure';
  const report={numFailedTestSuites:status==='failed'||named?1:0,testResults:[{assertionResults:status==='empty'?[]:named?[{status:'passed',fullName:'suite > fine'},{status:'failed',fullName:'suite > breaks the paint',failureMessages:['AssertionError: expected red to be blue\\n    at x.test.ts:1:1']}]:[{status}]}]};
  const output=args.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length);
  if(status!=='missing-report'&&status!=='exit-no-report') writeFileSync(output,status==='invalid-report'?'not-json':JSON.stringify(report));
  if(status==='exit-no-report') return {status:1,stdout:'',stderr:'Error: Failed to load url ./missing.ts\\nvitest exited'};
  return {status:status==='exit-failure'||named?1:0,stdout:'JSON report written to '+output,stderr:''};
}
export async function runLegs() {
  const selected=legs.filter(l=>l.name==='checked artwork preserves paint and scopes references without changing legacy rendering'||l.name==='lazy index and geometry loading');
  const results=selected.map(l=>{try{return {name:l.name,result:l.fn()};}catch(e){return {name:l.name,result:e.message};}});
  console.log(JSON.stringify(results));
  process.exitCode=results.length===2&&results.every(r=>r.result===true)?0:1;
}
`,
  );
  return sb;
}
const probe = (sb, mode = 'passed', file = ART) =>
  sb.node('scripts/gates/m18-complete.mjs', [], { env: { ...process.env, PROBE_MODE: mode, PROBE_FILE: file } });

describe('M18 feature completion wiring (HARNESS, FR-LIB-004, FR-LIB-009)', () => {
  it('runs actual artwork and legacy suites in browser and the SDK loader in node', () => {
    const sb = fixture();
    try {
      const r = probe(sb);
      assert.equal(r.status, 0, out(r));
      const calls = readFileSync(sb.path('calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        calls.map((args) => [args.at(-1), args[args.indexOf('--project') + 1]]).sort(),
        [
          [ART, 'browser'],
          [LEGACY, 'browser'],
          [LOADER, 'node'],
        ].sort(),
      );
    } finally {
      sb.cleanup();
    }
  });

  it('names the first failing test and its failure line when a suite exits non-zero (M18.166, cp22 F3)', () => {
    const sb = fixture();
    try {
      const r = probe(sb, 'named-failure', LOADER);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, /FAIL suite > breaks the paint: AssertionError: expected red to be blue"/);
      assert.doesNotMatch(r.stdout, /JSON report written|x\.test\.ts:1:1/);
      // a report without a failed test: the process output's tail, as before
      assert.match(probe(sb, 'exit-failure', LOADER).stdout, /JSON report written/);
      // no report at all: the process output's tail (M18.179, M18.166 review minor)
      const none = probe(sb, 'exit-no-report', LOADER);
      assert.equal(none.status, 1, out(none));
      assert.match(none.stdout, /Failed to load url \.\/missing\.ts \| vitest exited/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects empty, skipped, failing, absent or malformed reports for every intended suite', () => {
    const sb = fixture();
    try {
      for (const file of [ART, LEGACY, LOADER])
        for (const mode of ['empty', 'skipped', 'failed', 'exit-failure', 'missing-report', 'invalid-report']) {
          const r = probe(sb, mode, file);
          assert.equal(r.status, 1, `${file} ${mode}: ${out(r)}`);
        }
    } finally {
      sb.cleanup();
    }
  });

  it('refuses a missing artwork, legacy or loader suite', () => {
    for (const file of [ART, LEGACY, LOADER]) {
      const sb = fixture();
      try {
        rmSync(sb.path(file));
        const r = probe(sb);
        assert.equal(r.status, 1, out(r));
        assert.ok(r.stdout.includes(`missing ${file}`), out(r));
      } finally {
        sb.cleanup();
      }
    }
  });
});
