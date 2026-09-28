// NFR-DX-003: harness docs agree with the harness (M0 cp1 F3: one gate-test location).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { belowFloor } from '../../scripts/gates/lib.mjs';
import { cleanEnv, out, REPO, sandbox } from './helpers.mjs';

// the built schema, imported once at module level (see the catalogue suite below)
const SCHEMA_DIST = join(REPO, 'packages/schema/dist/index.js');
const schema = await import(pathToFileURL(SCHEMA_DIST).href).catch((e) => {
  throw new Error(`${SCHEMA_DIST} not importable (run pnpm run build first): ${e.message}`);
});

// Tracked Markdown only: scratch files under .harness/tmp (review packets) quote diffs verbatim.
const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
const files = tracked.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((p) => join(REPO, p));

describe('harness docs consistency (NFR-DX-003)', () => {
  it('name tests/harness as the only gate-test location', () => {
    const offenders = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (line.includes('__tests__') && !/not `scripts\/gates\/__tests__\/`/.test(line)) offenders.push(`${relative(REPO, f)}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, []);
  });

  it('describe the gate-test glob that precommit actually runs', () => {
    const pre = readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(pre, /'--test', 'tests\/harness\/\*\.test\.mjs'/);
  });

  // M1.37 (M1 cp2 F4, cp3 F4): the docs agents follow say what the toolchain does
  const read = (p) => readFileSync(join(REPO, p), 'utf8');
  const workspacesDirs = () => JSON.parse(read('tools/gen/workspaces.json')).workspaces.map((w) => w.dir);

  it('tech-stack names the engines floor and TS 6 only through the typescript6 catalog', () => {
    const stack = read('docs/standards/tech-stack.md');
    const floor = /(\d+\.\d+)/.exec(JSON.parse(read('package.json')).engines.node)[1];
    assert.match(stack, new RegExp(`Node\\.js LTS \\| ≥ ${floor.replace('.', '\\.')} `));
    assert.match(stack, /API Extractor bundles its own compiler/);
    assert.doesNotMatch(stack, /API Extractor\/TypeDoc\/Stryker need the TS 6/);
    assert.match(stack, /`typescript6` catalog, the single TS 6 pin/);
  });

  it('the typescript6 catalog is the only TS 6 pin in the repo (lockfile aside)', () => {
    const pins = spawnSync(
      'git',
      ['grep', '-l', 'npm:typescript@6', '--', '.', ':!pnpm-lock.yaml', ':!docs/**', ':!.harness/**', ':!tests/harness/docs-consistency.test.mjs'],
      { cwd: REPO, encoding: 'utf8', env: cleanEnv() },
    );
    assert.deepEqual(pins.stdout.split(/\r?\n/).filter(Boolean), ['pnpm-workspace.yaml']);
    const ws = read('pnpm-workspace.yaml');
    assert.equal(ws.match(/npm:typescript@6/g)?.length, 1, 'one TS 6 version string');
    // pnpm allows no catalog: specifier in packageExtensions, so the catalog reuses the one string (YAML anchor)
    assert.match(ws, /typescript: &typescript6 npm:typescript@6/);
    assert.match(ws, /typescript6:\r?\n {4}typescript: \*typescript6/);
    // no package pins TypeScript by version: TS 7 comes from the default catalog, TS 6 from typescript6
    for (const manifest of ['package.json', ...workspacesDirs().map((d) => `${d}/package.json`)]) {
      const pkg = JSON.parse(read(manifest));
      for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
        const spec = deps?.typescript;
        if (spec !== undefined) assert.ok(['catalog:', 'catalog:typescript6'].includes(spec), `${manifest}: typescript ${spec}`);
      }
    }
  });

  it('API reports live at packages/*/api/*.api.md, as check-api writes them', () => {
    assert.match(read('docs/architecture/09-extensibility.md'), /`packages\/\*\/api\/\*\.api\.md`/);
    assert.match(read('scripts/gates/check-api.mjs'), /reportFolder: '<projectFolder>\/api\/'/);
  });

  it('new-package steps use the generator and workspaces.json, and M1.md no longer says tsgo', () => {
    const steps = read('docs/standards/code-structure.md');
    assert.match(steps, /node tools\/gen\/package\.mjs <dir>/);
    assert.doesNotMatch(steps, /pnpm gen package|Add its layer rule to `\.dependency-cruiser\.mjs`/);
    assert.doesNotMatch(read('docs/milestones/M1.md'), /tsgo/);
  });

  it('ADR-0011 records its corrections in an Amendments section (documentation.md rule 8)', () => {
    assert.match(read('docs/standards/documentation.md'), /`## Amendments` section/);
    const adr = read('docs/architecture/decisions/ADR-0011-source-resolution-dual-compiler.md');
    const amendments = adr.split(/^## Amendments$/m)[1] ?? '';
    const lines = amendments.split(/\r?\n/).filter((l) => l.startsWith('- '));
    assert.ok(lines.length >= 3, 'amendment lines');
    for (const l of lines) assert.match(l, /^- \d{4}-\d{2}-\d{2} \(M\d+\.\d+\): /, l);
    // the TS 6 route it records is the one pnpm-workspace.yaml uses
    assert.match(amendments, /`&typescript6`/);
    assert.doesNotMatch(amendments, /references it \(`catalog:typescript6`\)/);
  });

  it('setup.mjs refuses a Node below the package.json engines floor', () => {
    assert.match(read('scripts/harness/setup.mjs'), /belowFloor\(process\.versions\.node, engines\)/);
    assert.equal(belowFloor('22.18.9', '>=22.19'), true);
    assert.equal(belowFloor('21.99.0', '>=22.19'), true);
    assert.equal(belowFloor('22.19.0', '>=22.19'), false);
    assert.equal(belowFloor('24.1.0', '>=22.19'), false);
    // and setup.mjs itself exits 1 on it (other steps also fail in a bare sandbox; the message is the floor's)
    const sb = sandbox(['scripts', 'package.json']);
    try {
      sb.edit('package.json', (t) => JSON.stringify({ ...JSON.parse(t), engines: { node: '>=99.0' } }));
      const high = sb.node('scripts/harness/setup.mjs');
      assert.equal(high.status, 1, out(high));
      assert.match(high.stderr, /is below the engines floor >=99\.0/);
      sb.edit('package.json', (t) => JSON.stringify({ ...JSON.parse(t), engines: { node: '>=1.0' } }));
      assert.doesNotMatch(sb.node('scripts/harness/setup.mjs').stderr, /below the engines floor/);
    } finally {
      sb.cleanup();
    }
  });
  // M3.24: 03-core-engine §1–§4 name only APIs @fluxion/core exports (its committed API report,
  // which check-api holds equal to the build)
  it('03 names core exports', () => {
    const report = read('packages/core/api/core.api.md');
    const doc = read('docs/architecture/03-core-engine.md');
    const sections = doc.slice(doc.indexOf('## 1. Store'), doc.indexOf('## 5. '));
    assert.ok(sections.includes('interface Store'), 'no §1 Store block found');
    assert.deepEqual(unknownCoreNames(sections, report), []);
    // reported: a member the Store lacks, a type a signature names that core does not export, a
    // member of a one-line declaration, a function core does not export and a stale property path
    const wrong =
      sections.replace('  fork(): Store;', '  fork(): Store;\n  frobnicate(): void;').replace('readonly history: History;', 'readonly history: Hystory;') +
      '\n```ts\ninterface Tx { put(record: AnyRecord): void; remove(id): void }\n```\nCall `renderAll()` after `store.frobnicat` (`FLX_NO_SUCH_CODE`, not `FLX_READ_ONLY`).\n';
    assert.deepEqual(unknownCoreNames(wrong, report), ['Hystory', 'Store.frobnicate', 'Tx.remove', 'renderAll', 'frobnicat', 'FLX_NO_SUCH_CODE']);
    // the pre-M3 doc's stale signatures (Query, Signal, Unsubscribe, CommandResult, ZodType) are caught
    const stale =
      '```ts\ninterface Store {\n  query<T>(q: Query<T>): Signal<T[]>;\n  subscribe(listener: (diff: Diff) => void): Unsubscribe;\n}\n```\n```ts\ninterface CommandDef<A> {\n  args: ZodType<A>;\n  run(ctx: CommandContext, args: A): void | CommandResult;\n}\n```\n';
    assert.deepEqual(unknownCoreNames(stale, report), ['Query', 'Signal', 'Unsubscribe', 'ZodType', 'CommandResult']);
  });

  // M2.23 (M2 cp1 F5): the 02-document-model record catalogue matches the built @fluxion/schema
  // a synchronous describe: node --test discovers the cases of an async one only in a full run, not
  // under --test-name-pattern, which is how the completion gate runs them (M3 cp1 F1)
  describe('02-document-model catalogue vs @fluxion/schema dist', () => {
    const doc = read('docs/architecture/02-document-model.md');
    const section = (from, to) => doc.slice(doc.indexOf(from), doc.indexOf(to, doc.indexOf(from)));
    const catalogue = catalogueRows(section('| Record | Key fields |', '### Element kinds'));
    const kinds = catalogueRows(section('| `kind` | Extra fields |', '### Anchors'));

    it('lists exactly the exported RECORD_TYPES, in the table and in the RecordType union', () => {
      assert.deepEqual([...catalogue.keys()].sort(), [...schema.RECORD_TYPES].sort());
      const union = /type RecordType =([^;]*);/.exec(doc)?.[1] ?? '';
      assert.deepEqual([...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort(), [...schema.RECORD_TYPES].sort());
    });

    it('lists exactly the core ELEMENT_KINDS (plugin rows exempt)', () => {
      assert.deepEqual([...kinds.keys()].filter((k) => !k.includes('<')).sort(), [...schema.ELEMENT_KINDS].sort());
    });

    const real = { catalogue, kinds, elementKinds: schema.ELEMENT_KINDS, shape: (record) => schema.schemaForRecord(record).schema.shape ?? {} };

    it("names only fields the record's schema has", () => {
      for (const [type, fields] of catalogue) assert.ok(fields.length > 0, `${type}: no key fields parsed`);
      assert.deepEqual(unknownCatalogueFields(real), []);
    });

    // M2 final F4: the element row names only fields every core kind has (the intersection, not the union)
    it('element-row field outside the core-kind intersection fails', () => {
      assert.deepEqual(unknownCatalogueFields(real), []);
      // connector has no transform: listing it in the element row is reported
      const withTransform = new Map(catalogue).set('element', [...catalogue.get('element'), 'transform']);
      assert.deepEqual(unknownCatalogueFields({ ...real, catalogue: withTransform }), ['element.transform']);
    });

    // M2 final F4: every required field of a record or core kind is in the catalogue (schema → docs)
    it('schema field missing from the catalogue fails', () => {
      assert.deepEqual(missingCatalogueFields(real), []);
      const noHash = new Map(catalogue).set(
        'asset',
        catalogue.get('asset').filter((f) => f !== 'hash'),
      );
      assert.deepEqual(missingCatalogueFields({ ...real, catalogue: noHash }), ['asset.hash']);
      const noDefId = new Map(kinds).set(
        'shape',
        kinds.get('shape').filter((f) => f !== 'defId'),
      );
      assert.deepEqual(missingCatalogueFields({ ...real, kinds: noDefId }), ['element(shape).defId']);
    });

    it('the row parser reads names outside parentheses and skips values', () => {
      const rows = catalogueRows("| `h` | f |\n|---|---|\n| `a` (x) | `f?` (`not`), `g {w,h}`, `h: 'x'\\|'y'`, `'lit'`, none | `n` |\n");
      assert.deepEqual([...rows], [['a', ['f', 'g', 'h']]]);
    });
  });
});

/**
 * What an API report declares: exported names (aliases like `History_2` under their export
 * name), the members of each exported interface or object type, the names it imports from
 * @fluxion/schema, and its string literals (registry names, error codes, origins).
 */
function coreApi(report) {
  const alias = new Map([...report.matchAll(/export \{ (\w+) as (\w+) \}/g)].map((m) => [m[1], m[2]]));
  const exports = new Set([...report.matchAll(/^export (?:declare )?(?:type|interface|function|const) (\w+)/gm)].map((m) => m[1]));
  for (const m of report.matchAll(/^export \{ (\w+)(?: as (\w+))? \}/gm)) exports.add(m[2] ?? m[1]);
  const imported = new Set([...report.matchAll(/^import \{ (\w+) \} from '@fluxion\/schema';/gm)].map((m) => m[1]));
  const members = new Map();
  for (const m of report.matchAll(/^(?:export )?(?:interface|type) (\w+)[^\n]*\{\n([\s\S]*?)^\}/gm)) {
    const names = [...m[2].matchAll(/^ {4}(?:readonly )?([\w$]+)\??[(<:]/gm)].map((x) => x[1]);
    members.set(alias.get(m[1]) ?? m[1], new Set(names));
  }
  const literals = new Set([...report.matchAll(/"([\w.-]+)"/g)].map((m) => m[1]));
  return { exports, imported, members, literals };
}

/**
 * Names a core-engine doc uses that core does not have: in ```ts blocks, see unknownInBlock; in
 * prose, each inline code span that is an identifier, a path or a call (`name`, `a.name`,
 * `a.name(…)`; the last name counts) must be an export, a member of an export, a schema import
 * a literal of the report, or a diagnostic code the built schema registers (`codes`).
 */
function unknownCoreNames(doc, report, codes = Object.keys(schema.DIAGNOSTIC_CODES)) {
  const api = coreApi(report);
  const blocks = [...doc.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  const unknown = blocks.flatMap((block) => unknownInBlock(block, api));
  const allMembers = new Set([...api.members.values()].flatMap((m) => [...m]));
  const known = (name) => api.exports.has(name) || api.imported.has(name) || api.literals.has(name) || allMembers.has(name) || codes.includes(name);
  const prose = doc.replace(/^```[\s\S]*?^```/gm, '');
  for (const [, span] of prose.matchAll(/`([^`\n]+)`/g)) {
    const name = /^(?:[\w$]+\.)*([A-Za-z_$][\w$]*)(?:\(|$)/.exec(span)?.[1];
    if (name && !known(name)) unknown.push(name);
  }
  return [...new Set(unknown)];
}

/** TypeScript's own types a signature may name. */
const TS_TYPES = new Set([
  'Array',
  'Map',
  'Set',
  'Promise',
  'Readonly',
  'ReadonlyArray',
  'ReadonlyMap',
  'ReadonlySet',
  'Record',
  'Partial',
  'Uint8Array',
  'PropertyKey',
]);

/** A type name a signature may use: an export, a schema import, a TypeScript type or a type parameter. */
const knownType = (type, api) => api.exports.has(type) || api.imported.has(type) || TS_TYPES.has(type) || type.length === 1;

/**
 * A ```ts block's names core lacks: declarations that are not exports, members their export lacks
 * (`Owner.member`, also on a one-line declaration) and types a signature names that are neither an
 * export, a schema import, a TypeScript type nor a one-letter type parameter.
 */
function unknownInBlock(block, api) {
  const unknown = [];
  let owner;
  for (const raw of block.split('\n')) {
    const code = raw.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''");
    unknown.push(...[...code.matchAll(/\b[A-Z][\w$]*\b/g)].map(([type]) => type).filter((type) => !knownType(type, api)));
    const decl = /^(?:interface|type) (\w+)[^{]*\{?(.*)$/.exec(code);
    if (decl) owner = decl[1];
    // a one-line declaration's members follow its brace, separated by semicolons
    const memberLines = decl ? decl[2].split(';').map((m) => ` ${m.trim()}`) : [code];
    for (const line of memberLines) {
      const member = /^\s+(?:readonly )?([\w$]+)\??[(<:]/.exec(line)?.[1];
      if (owner && member && !api.members.get(owner)?.has(member)) unknown.push(`${owner}.${member}`);
    }
  }
  return unknown;
}

/** Fields of a schema shape that are required (undefined does not parse). */
const requiredFields = (shape) =>
  Object.entries(shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
/** Every BaseRecord has these; the catalogue states them once, in the BaseRecord type. */
const BASE_FIELDS = ['id', 'type'];

/**
 * Catalogue fields the schemas lack: a record row against its record's shape, the element row
 * against the fields every core kind has (intersection), a kind row against that kind's shape.
 */
function unknownCatalogueFields({ catalogue, kinds, elementKinds, shape }) {
  const keys = (record) => Object.keys(shape(record));
  const common = elementKinds.map((kind) => keys({ type: 'element', kind })).reduce((acc, fields) => acc.filter((f) => fields.includes(f)));
  const unknown = (label, fields, known) => {
    assert.ok(known.length > 0, `${label}: schema has no object shape`);
    return fields.filter((f) => !known.includes(f)).map((f) => `${label}.${f}`);
  };
  return [
    ...[...catalogue].flatMap(([type, fields]) => unknown(type, fields, type === 'element' ? common : keys({ type }))),
    ...[...kinds].filter(([kind]) => !kind.includes('<')).flatMap(([kind, fields]) => unknown(`element(${kind})`, fields, keys({ type: 'element', kind }))),
  ];
}

/** Required schema fields the catalogue does not list (element kinds: element row plus kind row). */
function missingCatalogueFields({ catalogue, kinds, elementKinds, shape }) {
  const absent = (label, record, listed) =>
    requiredFields(shape(record))
      .filter((f) => !BASE_FIELDS.includes(f) && !listed.includes(f))
      .map((f) => `${label}.${f}`);
  return [
    ...[...catalogue].filter(([type]) => type !== 'element').flatMap(([type, fields]) => absent(type, { type }, fields)),
    ...elementKinds.flatMap((kind) => absent(`element(${kind})`, { type: 'element', kind }, [...(catalogue.get('element') ?? []), ...(kinds.get(kind) ?? [])])),
  ];
}

/**
 * Body rows (below `|---`) `| \`name\` … | fields | … |` → Map(name → field names): the leading identifier of
 * each backticked token in the second cell, after dropping parenthesized asides (examples, notes)
 * and tokens that are not identifiers (quoted literals).
 */
function catalogueRows(table) {
  const rows = new Map();
  const lines = table.split(/\r?\n/);
  for (const line of lines.slice(lines.findIndex((l) => l.startsWith('|---')) + 1)) {
    const cells = line.replace(/\\\|/g, '\u0000').split('|').slice(1, -1);
    const name = /^\s*`([^`]+)`/.exec(cells[0] ?? '')?.[1];
    if (!name || cells.length < 2) continue;
    let text = cells[1];
    for (let prev = ''; prev !== text; ) [prev, text] = [text, text.replace(/\([^()]*\)/g, '')];
    const fields = [...text.matchAll(/`([A-Za-z][A-Za-z0-9]*)[^`]*`/g)].map((m) => m[1]);
    rows.set(name, fields);
  }
  return rows;
}
