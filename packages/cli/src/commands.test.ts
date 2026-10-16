import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, writeFlux } from '@fluxion/format';
import { parseDocument } from '@fluxion/schema';
import { afterAll, describe, expect, it } from 'vitest';
import type { CliIo } from './command.js';
import { run } from './main.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-inproc-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the CLI in-process with `--json`, so the command bodies are measured (the e2e tests spawn the bin). */
async function cli(...argv: string[]) {
  const out: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: () => undefined };
  const code = await run([...argv, '--json'], io);
  return { code, reply: JSON.parse(out.join('')) as { ok: boolean; result?: Record<string, unknown>; errors?: { code: string }[] } };
}

describe('the document commands in-process (FR-CLI-002, FR-LAY-004, FR-EXP-007)', () => {
  const compiled = join(dir, 'a.flux.json');
  const src = join(dir, 'b.flux.yaml');
  writeFileSync(src, 'flux: 1\ntitle: Base\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n');

  it('FR-CLI-002: compile, validate, lint and layout --score run and report', async () => {
    expect((await cli('compile', 'examples/dsl/edge-ops.flux.yaml', '-o', compiled)).code).toBe(0);
    expect((await cli('compile', 'fixtures/docs/minimal.flux.json', '-o', join(dir, 'no.json'))).code).toBe(1);
    expect((await cli('compile', src)).code).toBe(2);
    expect((await cli('validate', compiled)).code).toBe(0);
    expect((await cli('lint', compiled)).code).toBe(0);
    expect((await cli('lint', compiled, '--min-score', 'x')).code).toBe(2);
    const scored = await cli('layout', compiled, '--score');
    expect(scored.code).toBe(0);
    expect(scored.reply.result?.['scores']).toBeInstanceOf(Array);
    expect((await cli('layout', compiled)).code).toBe(2);
    expect((await cli('layout', compiled, '-o', join(dir, 'l.json'), '--algorithm', 'nope')).code).toBe(2);
    expect((await cli('layout', compiled, '-o', join(dir, 'l.json'), '--algorithm', 'grid')).code).toBe(0);
  });

  it('FR-CLI-002: migrate, decompile, patch and catalog run and report', async () => {
    const migrated = join(dir, 'm.json');
    expect((await cli('migrate', 'packages/schema/src/__fixtures__/v1.0/document.flux.json', '-o', migrated)).code).toBe(0);
    expect((await cli('migrate', migrated)).code).toBe(2);
    const yaml = join(dir, 'back.yaml');
    expect((await cli('decompile', compiled, '-o', yaml)).code).toBe(0);
    const mmd = join(dir, 'f.mmd');
    expect((await cli('decompile', compiled, '-o', mmd, '--format', 'mermaid')).code).toBe(0);
    expect(readFileSync(mmd, 'utf8').startsWith('flowchart')).toBe(true);
    expect((await cli('decompile', compiled, '-o', mmd, '--format', 'dot')).code).toBe(2);
    const base = join(dir, 'base.flux.json');
    expect((await cli('compile', src, '-o', base)).code).toBe(0);
    const patched = join(dir, 'p.json');
    expect((await cli('patch', base, 'fixtures/patches/add-node.patch.json', '-o', patched)).code).toBe(0);
    const bad = join(dir, 'bad.patch.json');
    writeFileSync(bad, '{"flux":1,"ops":[{"op":"remove","target":"nothing-here"}]}');
    expect((await cli('patch', base, bad, '-o', join(dir, 'never.json'))).code).toBe(1);
    expect(existsSync(join(dir, 'never.json'))).toBe(false);
    expect((await cli('catalog', '--format', 'json')).code).toBe(0);
    expect((await cli('catalog', '--format', 'xml')).code).toBe(2);
  });

  it('FR-EXP-008: convert and render run in-process over a .flux and a document', async () => {
    const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
    const parsed = parseDocument(readFileSync('fixtures/docs/two-rects-line.flux.json', 'utf8'));
    if (!parsed.ok) throw new Error('the fixture does not parse');
    const written = await writeFlux({ document: parsed.value.document, appVersion: '1.0.0', hasher, source: 'flux: 1\n' });
    if (!written.ok) throw new Error(written.error.reason);
    const flux = join(dir, 'd.flux');
    writeFileSync(flux, written.value);
    const html = join(dir, 'd.flux.html');
    const json = join(dir, 'd.flux.json');
    expect((await cli('convert', flux, html)).code).toBe(0);
    expect((await cli('convert', html, join(dir, 'e.flux'))).code).toBe(0);
    expect((await cli('convert', flux, json)).code).toBe(0);
    expect((await cli('convert', flux, json, '--assets', 'external')).code).toBe(0);
    expect((await cli('convert', json, join(dir, 'f.flux'))).code).toBe(0);
    expect((await cli('convert', flux, json, '--assets', 'weird')).code).toBe(2);
    expect((await cli('convert', join(dir, 'absent.flux'), html)).code).toBe(1);
    expect((await cli('convert', flux)).code).toBe(2);
    const page = join(dir, 'r.html');
    expect((await cli('render', 'fixtures/docs/two-rects-line.flux.json', '-o', page, '--format', 'svg')).code).toBe(2);
    expect((await cli('render', 'fixtures/docs/two-rects-line.flux.json', '-o', page, '--screen', 'nope')).code).toBe(2);
  });

  it('FR-CLI-002: usage mistakes, unreadable inputs and the other catalog outputs are reported, not thrown', async () => {
    const f = 'fixtures/docs/minimal.flux.json';
    const absent = join(dir, 'absent.json');
    const out = join(dir, 'o.txt');
    for (const argv of [
      ['patch'],
      ['patch', f],
      ['patch', f, f, f, '-o', out],
      ['patch', f, f],
      ['decompile'],
      ['decompile', f, f, '-o', out],
      ['decompile', f],
      ['catalog', f],
      ['validate'],
      ['lint'],
      ['layout'],
      ['migrate'],
      ['compile'],
    ])
      expect((await cli(...argv)).code, argv.join(' ')).toBe(2);
    for (const argv of [
      ['patch', absent, f, '-o', out],
      ['patch', f, absent, '-o', out],
      ['decompile', absent, '-o', out],
      ['decompile', absent, '-o', out, '--format', 'mermaid'],
      ['decompile', f, '-o', join(dir, 'no-such-dir/x/y.yaml')],
      ['validate', absent],
      ['lint', absent],
      ['layout', absent, '--score'],
      ['migrate', absent, '-o', out],
      ['compile', absent, '-o', out],
    ])
      expect((await cli(...argv)).code, argv.join(' ')).toBe(1);
    const file = join(dir, 'cat.md');
    const written = await cli('catalog', '--format', 'md', '-o', file);
    expect(written.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect((await cli('catalog', '--format', 'md', '-o', join(dir, 'x/y/z.md'))).code).toBe(1);
    expect((await cli('catalog')).code).toBe(0);
    const text = join(dir, 'not-json.txt');
    writeFileSync(text, 'not json');
    expect((await cli('lint', text)).code).toBe(1);
    expect((await cli('validate', text)).code).toBe(1);
    expect((await cli('migrate', text, '-o', out)).code).toBe(1);
    expect((await cli('layout', text, '--score')).code).toBe(1);
  });
});
