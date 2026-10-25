// NFR-MNT-005: exercise the real collector/wrapper with a synthetic engine, never as mutation qualification.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const engine = `import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2), mode=process.env.FIXTURE_MUTATION_MODE;
const at=f=>args[args.indexOf(f)+1];
if(args[0]==='model') { console.log(JSON.stringify({packages:[{testProjects:['node','browser'],sources:[]}]})); process.exit(0); }
const model=JSON.parse(readFileSync(at('-m'),'utf8'));
if(JSON.stringify(model.packages[0].testProjects)!==JSON.stringify(['node','browser'])) process.exit(3);
const packages=model.packages[0].sources.map(s=>s.split('/src/')[0]);
const mutants=packages.map(p=>({id:p,file:p+'/src/value.ts',mutatorName:'BooleanLiteral',location:{start:{line:1,column:1},end:{line:1,column:5}},original:'true',replacement:'false'}));
if(args[0]==='list-mutants') { if(mode==='change-during-inventory') writeFileSync('packages/core/src/value.ts','export const value = false;'); console.log(JSON.stringify(mutants)); process.exit(mode==='inventory-failed'?3:0); }
console.log('FIXTURE_EXECUTED');
const dir=at('-o'); mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'tzap.json'),JSON.stringify({schemaVersion:1,tzapVersion:'0.1.1',config:{scope:'full',mutators:['all']},redTests:[],tests:[{id:'node'},{id:'browser'}],timings:{coverage:1,execute:2},mutants:mode==='partial'?[]:mutants.map(m=>({...m,status:'Killed'}))}));
process.exit(mode==='execution-failed'?3:0);
`;

function fixture() {
  const sb = sandbox(['scripts', '.gitignore'], { git: true });
  sb.write('tools/gen/workspaces.json', JSON.stringify({ workspaces: ['core', 'anim'].map((p) => ({ dir: `packages/${p}`, runtime: 'pure' })) }));
  sb.write('.harness/baselines/mutation.json', JSON.stringify({ packages: { 'packages/core': { score: 100 } } }));
  for (const name of ['core', 'anim']) sb.write(`packages/${name}/src/value.ts`, 'export const value = true;\n');
  sb.write('node_modules/@huyz0/tzap/dist/bin.js', engine);
  sb.write('node_modules/@huyz0/tzap/package.json', JSON.stringify({ type: 'module', version: '0.1.1' }));
  sb.git('add', '.');
  const commit = sb.git('commit', '-qm', 'fixture inputs');
  assert.equal(commit.status, 0, out(commit));
  return sb;
}

const plan = (sb, env = process.env) => sb.node('scripts/harness/mutation-plan.mjs', ['--out', 'reports/plan.json'], { env });
const execute = (sb, mode = '') =>
  sb.node('scripts/harness/mutate-shard.mjs', ['--manifest', 'reports/plan.json', '--package', 'packages/core', '--out-dir', 'reports/core'], {
    env: { ...process.env, FIXTURE_MUTATION_MODE: mode },
  });

describe('isolated mutation execution (NFR-MNT-005)', () => {
  it('collects every pure package and retains full test scope in a fresh report', () => {
    const sb = fixture();
    try {
      const collected = plan(sb);
      assert.equal(collected.status, 0, out(collected));
      const manifest = JSON.parse(sb.read('reports/plan.json'));
      assert.deepEqual(manifest.packages, ['packages/anim', 'packages/core']);
      assert.deepEqual(manifest.floors, { 'packages/anim': 70, 'packages/core': 100 });
      assert.equal(manifest.mutants.length, 2);
      const result = execute(sb);
      assert.equal(result.status, 0, out(result));
      const shard = JSON.parse(sb.read('reports/core/shard.json'));
      assert.equal(shard.revision, manifest.revision);
      assert.equal(shard.exitCode, 0);
      assert.deepEqual(shard.report.tests, [{ id: 'node' }, { id: 'browser' }]);
      assert.deepEqual(shard.report.timings, { coverage: 1, execute: 2 });
      assert.ok(Number.isFinite(shard.elapsedMs) && shard.elapsedMs >= 0);
      assert.equal(shard.report.mutants.length, 1);
      assert.ok(sb.read('reports/core/tzap.json').includes('Killed'));
    } finally {
      sb.cleanup();
    }
  });

  it('failed execution remains failing despite a written passing report', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = execute(sb, 'execution-failed');
      assert.notEqual(result.status, 0, out(result));
      assert.notEqual(JSON.parse(sb.read('reports/core/shard.json')).exitCode, 0);
      assert.ok(sb.read('reports/core/tzap.json').includes('Killed'));
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a partial report that the old zero-valid score would accept', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = execute(sb, 'partial');
      assert.notEqual(result.status, 0, out(result));
      assert.notEqual(JSON.parse(sb.read('reports/core/shard.json')).exitCode, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects stale revisions, changed sources and untracked execution inputs before running', () => {
    for (const change of [
      (sb) => {
        sb.write('packages/core/src/value.ts', 'export const value = false;\n');
      },
      (sb) => {
        sb.write('packages/core/src/new.ts', 'export const another = true;\n');
      },
      (sb) => {
        sb.write('README.md', 'new revision\n');
        sb.git('add', 'README.md');
        sb.git('commit', '-qm', 'next fixture');
      },
      (sb) => {
        const p = JSON.parse(sb.read('reports/plan.json'));
        p.floors['packages/core'] = 70;
        sb.write('reports/plan.json', JSON.stringify(p));
      },
    ]) {
      const sb = fixture();
      try {
        assert.equal(plan(sb).status, 0);
        sb.write('reports/core/shard.json', JSON.stringify({ exitCode: 0, stale: true }));
        change(sb);
        const result = execute(sb);
        assert.notEqual(result.status, 0, out(result));
        assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
        const failed = JSON.parse(sb.read('reports/core/shard.json'));
        assert.notEqual(failed.exitCode, 0);
        assert.equal(failed.stale, undefined);
      } finally {
        sb.cleanup();
      }
    }
  });

  it('rejects changed property-test settings before executing a shard', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = sb.node(
        'scripts/harness/mutate-shard.mjs',
        ['--manifest', 'reports/plan.json', '--package', 'packages/core', '--out-dir', 'reports/core'],
        { env: { ...process.env, FC_RUNS: process.env.FC_RUNS === '987' ? '988' : '987' } },
      );
      assert.notEqual(result.status, 0, out(result));
      assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a checkout changed while its inventory is being collected', () => {
    const sb = fixture();
    try {
      const result = plan(sb, { ...process.env, FIXTURE_MUTATION_MODE: 'change-during-inventory' });
      assert.notEqual(result.status, 0, out(result));
      assert.equal(existsSync(sb.path('reports/plan.json')), false);
    } finally {
      sb.cleanup();
    }
  });

  it('failed inventory generation is not accepted even if it prints valid JSON', () => {
    const sb = fixture();
    try {
      sb.write('reports/plan.json', JSON.stringify({ stale: true }));
      const result = plan(sb, { ...process.env, FIXTURE_MUTATION_MODE: 'inventory-failed' });
      assert.notEqual(result.status, 0, out(result));
      assert.match(result.stderr, /list-mutants.*exited 3/);
      assert.equal(existsSync(sb.path('reports/plan.json')), false);
    } finally {
      sb.cleanup();
    }
  });
});
