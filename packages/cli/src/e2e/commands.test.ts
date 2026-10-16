import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { E2E_TIMEOUT, fluxion } from './spawn-bin.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-commands-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Reply = {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly result?: Record<string, unknown>;
  readonly errors?: readonly { readonly code: string }[];
};

/** Runs `fluxion <args> --json`, checks the reply against its command's schema, and returns it with the exit status. */
function json(command: string, args: readonly string[]): { status: number | null; reply: Reply } {
  const r = fluxion([command, ...args, '--json']);
  const parsed = OUTPUT_SCHEMAS[command]?.safeParse(JSON.parse(r.stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return { status: r.status, reply: parsed?.data as Reply };
}

describe('the document commands (FR-CLI-002, ADR-0036)', { timeout: E2E_TIMEOUT }, () => {
  const compiled = join(dir, 'edge-ops.flux.json');

  it('FR-CLI-002: fluxion compile --json writes the document and reports its counts', () => {
    const { status, reply } = json('compile', ['examples/dsl/edge-ops.flux.yaml', '-o', compiled]);
    expect(status).toBe(0);
    expect(reply.result).toMatchObject({ out: compiled });
    expect(existsSync(compiled)).toBe(true);
    expect(json('validate', [compiled]).status).toBe(0);
  });

  it('FR-CLI-002: fluxion compile --json exits 1 and writes nothing for a file that is not FluxScript', () => {
    const { status, reply } = json('compile', ['fixtures/docs/minimal.flux.json', '-o', join(dir, 'never.json')]);
    expect(status).toBe(1);
    expect(reply.errors?.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'never.json'))).toBe(false);
  });

  it('FR-CLI-002: fluxion validate --json is the same reply as before the operation layer', () => {
    expect(json('validate', ['fixtures/docs/minimal.flux.json']).status).toBe(0);
  });

  it('FR-CLI-002: fluxion lint --json reports a score, and --min-score above it exits 1', () => {
    const ok = json('lint', [compiled]);
    expect(ok.status).toBe(0);
    expect(typeof ok.reply.result?.['score']).toBe('number');
    // two shapes on the same box overlap, so the score is below 100
    const b = documentBuilder({ seed: 15 });
    const screen = b.screen();
    b.rect(screen, { x: 0, y: 0, w: 100, h: 50 });
    b.rect(screen, { x: 10, y: 5, w: 100, h: 50 });
    const stacked = join(dir, 'stacked.flux.json');
    writeFileSync(stacked, serializeDocument(b.build()));
    const low = json('lint', [stacked, '--min-score', '100']);
    expect(low.status).toBe(1);
    expect(low.reply.errors?.map((e) => e.code)).toContain('FLX_LINT_SCORE_BELOW_MIN');
    expect(fluxion(['lint', compiled, '--min-score', 'lots', '--json']).status).toBe(2);
  });

  it('FR-CLI-002: fluxion layout --json arranges the screens into the output file', () => {
    const out = join(dir, 'laid-out.flux.json');
    const { status, reply } = json('layout', [compiled, '-o', out, '--algorithm', 'layered']);
    expect(status).toBe(0);
    expect(reply.result).toMatchObject({ out, algorithm: 'layered' });
    expect(JSON.parse(readFileSync(out, 'utf8')).schemaVersion).toBeTypeOf('string');
    expect(fluxion(['layout', compiled, '-o', out, '--algorithm', 'nope', '--json']).status).toBe(2);
  });

  it('FR-CLI-002: fluxion migrate --json brings an old document to the current version', () => {
    const out = join(dir, 'migrated.flux.json');
    const { status, reply } = json('migrate', ['packages/schema/src/__fixtures__/v1.0/document.flux.json', '-o', out]);
    expect(status).toBe(0);
    expect(((reply.result?.['applied'] ?? []) as string[]).length).toBeGreaterThan(0);
    expect(json('validate', [out]).status).toBe(0);
    expect(json('migrate', [out, '-o', join(dir, 'again.flux.json')]).reply.result?.['applied']).toEqual([]);
  });

  it('FR-CLI-002: a missing -o is a usage error', () => {
    expect(fluxion(['compile', 'examples/dsl/edge-ops.flux.yaml', '--json']).status).toBe(2);
    expect(fluxion(['migrate', compiled, '--json']).status).toBe(2);
  });
});
