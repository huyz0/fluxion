// The format specification states numbers the loader enforces: this keeps the two together (M10 final review F3).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('specs/format/flux-1.0.md states the loader limits, the schema version and the stored extensions the code uses', () => {
  const spec = read('specs/format/flux-1.0.md');
  const loader = read('packages/format/src/loader.ts');
  const limits =
    /DEFAULT_LIMITS[^=]*=\s*\{\s*maxEntries:\s*(\d+),\s*maxEntryBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024,\s*maxTotalBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(
      loader,
    );
  assert.ok(limits, 'DEFAULT_LIMITS has the expected shape');
  const [, entries, entryMb, totalMb] = limits;
  assert.ok(spec.includes(`at most ${entries} entries, ${entryMb} MB inflated per entry and ${totalMb} MB inflated in all`), 'the spec states the limits');
  const schema = /SCHEMA_VERSION: string = '([^']+)'/.exec(read('packages/schema/src/document-file.ts'));
  assert.ok(schema && spec.includes(`now ${schema[1]}`), 'the spec names the current schema version');
  const stored = /const STORED = new Set\(\[([^\]]+)\]\)/.exec(read('packages/format/src/flux-writer.ts'));
  assert.ok(stored);
  for (const ext of stored[1].split(',').map((x) => x.trim().replace(/'/g, '')))
    assert.ok(spec.includes(`\`${ext}\``), `the spec lists the stored extension ${ext}`);
});
