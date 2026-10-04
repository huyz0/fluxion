#!/usr/bin/env node
// Public API gate (NFR-MNT-007; contracts.md; non-negotiable 6).
//   check-api.mjs              every library's built dist/index.d.ts vs its committed api/<name>.api.md, and each subpath entry of its
//                              package.json exports (`./mount`) vs api/<name>.<subpath>.api.md (M10.29)
//   check-api.mjs --update     rewrite the reports (a reviewed contract change; run after a build)
//   check-api.mjs --dir <root> [--package <dir>]   another checkout / one library (tests; tools from FLUXION_TOOLS_ROOT)
// API Extractor reads the emitted declarations with its own bundled compiler (ADR-0011). Exports need
// a release tag (ae-missing-release-tag is an error); any other warning fails the gate too.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { REPO_ROOT, run } from './lib.mjs';

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const dirArg = argv.indexOf('--dir');
const root = dirArg >= 0 ? resolve(argv[dirArg + 1]) : REPO_ROOT;
const tools = process.env.FLUXION_TOOLS_ROOT ?? REPO_ROOT;
const { Extractor, ExtractorConfig } = createRequire(join(tools, 'package.json'))('@microsoft/api-extractor');

const { workspaces } = JSON.parse(readFileSync(join(root, 'tools/gen/workspaces.json'), 'utf8'));
const only = argv.includes('--package') ? argv[argv.indexOf('--package') + 1] : undefined;
const libraries = workspaces.filter((w) => (w.dir.startsWith('packages/') || w.dir.startsWith('packs/')) && (!only || w.dir === only));
if (only && libraries.length === 0) {
  console.error(`api: ${only} is not a library in workspaces.json`);
  process.exit(2);
}

/**
 * The entry points of a library: its main declarations, then each subpath its `exports` lists with a `types` file (`./mount` is `mount`). A subpath
 * without one cannot be reported, and is a failure rather than a silent gap (`problems`).
 */
function entriesOf(folder, problems) {
  const exportsMap = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).exports;
  const listed = Object.entries(typeof exportsMap === 'object' && exportsMap !== null ? exportsMap : {}).filter(([key]) => key !== '.');
  const subpaths = [];
  for (const [key, value] of listed) {
    if (typeof value?.types !== 'string') problems.push(`the export "${key}" has no "types" file, so its API cannot be reported: give it one`);
    else subpaths.push({ name: key.replace(/^\.\//, '').replaceAll('/', '.'), types: value.types.replace(/^\.\//, '') });
  }
  return [{ name: undefined, types: 'dist/index.d.ts' }, ...subpaths];
}

const configFor = (folder, entry) => ({
  projectFolder: folder,
  // reports are compared across OSes; .gitattributes stores LF
  newlineKind: 'lf',
  mainEntryPointFilePath: `<projectFolder>/${entry.types}`,
  // the declarations only: the package tsconfig targets TS 7 and src/, not dist/
  compiler: {
    overrideTsconfig: {
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2023', 'DOM'],
        types: [],
        strict: true,
        skipLibCheck: true,
      },
      files: [entry.types],
    },
  },
  apiReport: {
    enabled: true,
    reportFolder: '<projectFolder>/api/',
    reportTempFolder: '<projectFolder>/.tsbuild/api/',
    reportFileName: entry.name === undefined ? '<unscopedPackageName>.api.md' : `<unscopedPackageName>.${entry.name}.api.md`,
  },
  docModel: { enabled: false },
  dtsRollup: { enabled: false },
  tsdocMetadata: { enabled: false },
  messages: {
    compilerMessageReporting: { default: { logLevel: 'error' } },
    extractorMessageReporting: {
      default: { logLevel: 'warning' },
      'ae-missing-release-tag': { logLevel: 'error', addToApiReportFile: false },
      // a subpath entry names types the package's main entry exports (the report lists them as imports): they are that entry's contract, not forgotten
      ...(entry.name === undefined ? {} : { 'ae-forgotten-export': { logLevel: 'none', addToApiReportFile: false } }),
    },
    tsdocMessageReporting: { default: { logLevel: 'warning' } },
  },
});

const failures = [];
let reports = 0;
for (const w of libraries) {
  const folder = join(root, w.dir);
  mkdirSync(join(folder, 'api'), { recursive: true });
  const problems = [];
  const entries = entriesOf(folder, problems);
  if (problems.length > 0) failures.push(`${w.dir}:\n  ${problems.join('\n  ')}`);
  for (const entry of entries) {
    reports += 1;
    const config = ExtractorConfig.prepare({
      configObject: configFor(folder, entry),
      configObjectFullPath: undefined,
      packageJsonFullPath: join(folder, 'package.json'),
    });
    const messages = [];
    const result = Extractor.invoke(config, {
      localBuild: update,
      messageCallback: (m) => {
        // in --update, API Extractor reports writing or creating the report as a warning; that is the point of the run
        const expected = update && ['console-api-report-copied', 'console-api-report-created'].includes(m.messageId);
        if ((m.logLevel === 'error' || m.logLevel === 'warning') && !expected) messages.push(`${m.messageId}: ${m.text}`);
        m.handled = true;
      },
    });
    if (!result.succeeded || messages.length > 0 || (!update && result.apiReportChanged)) {
      const why = result.apiReportChanged && !update ? ['public API changed: update the report (check-api.mjs --update) in a reviewed contract change'] : [];
      failures.push(`${w.dir}${entry.name === undefined ? '' : ` (${entry.name})`}:\n  ${[...why, ...messages].join('\n  ') || 'API Extractor failed'}`);
    }
  }
}

// TSDoc completeness of every public export, with TypeDoc on TS 6 (apps/docs installs it; ADR-0011)
// the checkout's typedoc.json, so tests can prove the TSDoc half on a sandbox (M1.36, cp3 F3)
if (!only) {
  // apps/docs' typedoc (its peer is TS 6), run from the checkout so entry points resolve there
  const typedoc = join(tools, 'apps', 'docs', 'node_modules', 'typedoc', 'bin', 'typedoc');
  const r = run(process.execPath, [typedoc, '--options', 'typedoc.json', '--emit', 'none'], { cwd: root });
  if (r.status !== 0) failures.push(`typedoc (typedoc.json):\n  ${`${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).slice(-15).join('\n  ')}`);
}

if (failures.length) {
  for (const f of failures) console.error(`api: ${f}`);
  process.exit(1);
}
console.log(`api: ${reports} API report(s) ${update ? 'written' : 'match'}`);
