import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const USED = 'packages/format/src/artwork-font-retention.test.ts';
const CREDITS = 'packages/cli/src/e2e/cli.artwork-fonts.test.ts';
const BROWSER = 'e2e/artwork.font-retention.spec.ts';
function fixture() {
  const sb = sandbox(['scripts/gates/m18-complete.mjs']);
  for (const file of [USED, CREDITS, BROWSER]) sb.write(file, '// Runner-port probe; real suites execute separately.');
  sb.write('scripts/gates/thresholds.mjs', 'export const t=()=>1;');
  sb.write(
    'scripts/gates/milestone-checks.mjs',
    `
import { writeFileSync, existsSync } from 'node:fs';
export const backlogTextFor=()=>'', benchUnder=()=>true, changesetsCoverRange=()=>true, checkBacklogDone=()=>true, checkFinalReview=()=>true, imageRunner=()=>null, loadMilestoneReviews=()=>[], namedCases=()=>true, verifyLeg=()=>true;
export function playwrightSpecs(specs, projects) {
  writeFileSync('browser.json', JSON.stringify({specs,projects}));
  if(specs.some(f=>!existsSync(f))) return 'missing browser acceptance';
  return process.env.BAD_BROWSER==='1' ? 'failed browser report' : true;
}
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
  const status=args.at(-1)===process.env.BAD_UNIT ? 'skipped' : 'passed';
  writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice('--outputFile='.length),JSON.stringify({numFailedTestSuites:0,testResults:[{assertionResults:[{status}]}]}));
  return {status:0,stdout:'',stderr:''};
}
export function runLegs() {
  const selected=legs.filter(l=>l.name==='imported artwork retains exact licensed fonts offline');
  const results=selected.map(l=>{try{return l.fn();}catch(e){return e.message;}});
  console.log(JSON.stringify(results)); process.exitCode=results.length===1&&results.every(r=>r===true)?0:1;
}
`,
  );
  return sb;
}
const probe = (sb, extra = {}) => sb.node('scripts/gates/m18-complete.mjs', [], { env: { ...process.env, ...extra } });

describe('artwork-font retention completion acceptance (HARNESS, FR-LIB-004, FR-AST-003, NFR-LIC-003)', () => {
  it('requires real format suites and all three offline browser projects', () => {
    const sb = fixture();
    try {
      const r = probe(sb);
      assert.equal(r.status, 0, out(r));
      const calls = readFileSync(sb.path('calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        calls.map((args) => [args.at(-1), args[args.indexOf('--project') + 1]]).sort(),
        [
          [USED, 'node'],
          [CREDITS, 'node'],
        ].sort(),
      );
      assert.deepEqual(JSON.parse(readFileSync(sb.path('browser.json'), 'utf8')), {
        specs: [BROWSER],
        projects: ['chromium', 'firefox', 'webkit'],
      });
    } finally {
      sb.cleanup();
    }
  });
  it('cannot qualify portable rendering from passing unit suites when the browser report fails', () => {
    const sb = fixture();
    try {
      assert.equal(probe(sb, { BAD_BROWSER: '1' }).status, 1);
    } finally {
      sb.cleanup();
    }
  });
  it('refuses missing acceptance files and skipped format assertions', () => {
    for (const file of [USED, CREDITS, BROWSER]) {
      const sb = fixture();
      try {
        rmSync(sb.path(file));
        assert.equal(probe(sb).status, 1);
      } finally {
        sb.cleanup();
      }
    }
    for (const file of [USED, CREDITS]) {
      const sb = fixture();
      try {
        assert.equal(probe(sb, { BAD_UNIT: file }).status, 1);
      } finally {
        sb.cleanup();
      }
    }
  });
});
