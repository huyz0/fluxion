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
  const report={numFailedTestSuites:status==='failed'?1:0,testResults:[{assertionResults:status==='empty'?[]:[{status}]}]};
  const output=args.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length);
  if(status!=='missing-report') writeFileSync(output,status==='invalid-report'?'not-json':JSON.stringify(report));
  return {status:status==='exit-failure'?1:0,stdout:'probe',stderr:''};
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
