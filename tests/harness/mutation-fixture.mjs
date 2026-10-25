// Shared synthetic engine for control-flow tests; never mutation qualification.
import assert from 'node:assert/strict';
import { out, sandbox } from './helpers.mjs';

const engine = `import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2), mode=process.env.FIXTURE_MUTATION_MODE;
const at=f=>args[args.indexOf(f)+1];
if(args[0]==='model') { console.log(JSON.stringify({packages:[{testProjects:['node','browser'],sources:[]}]})); process.exit(0); }
const model=JSON.parse(readFileSync(at('-m'),'utf8'));
if(JSON.stringify(model.packages[0].testProjects)!==JSON.stringify(['node','browser'])) process.exit(3);
const packages=model.packages[0].sources.map(s=>s.split('/src/')[0]);
const files=model.packages[0].sources.flatMap(s=>s.includes('*')?readdirSync(join(s.split('/src/')[0],'src')).filter(f=>f.endsWith('.ts')).map(f=>s.split('/src/')[0]+'/src/'+f):[s]);
const mutants=files.map(file=>({id:file,file,mutatorName:'BooleanLiteral',location:{start:{line:1,column:1},end:{line:1,column:5}},original:'true',replacement:'false'}));
if(args[0]==='list-mutants') { if(mode==='change-during-inventory') writeFileSync('packages/core/src/value.ts','export const value = false;'); console.log(JSON.stringify(mutants)); process.exit(mode==='inventory-failed'?3:0); }
console.log('FIXTURE_EXECUTED');
const dir=at('-o'); mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'tzap.json'),JSON.stringify({schemaVersion:1,tzapVersion:'0.1.1',config:{scope:'full',mutators:['all']},redTests:[],tests:[{id:'node'},{id:'browser'}],timings:{coverage:1,execute:2},mutants:mode==='partial'?[]:mutants.map(m=>({...m,status:'Killed'}))}));
process.exit(mode==='execution-failed'?3:0);
`;

export function mutationFixture() {
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
