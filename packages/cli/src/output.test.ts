import { describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS, outputJsonSchema } from './output.js';

describe('--json reply schemas (contracts.md §1, §6; ADR-0147)', () => {
  // the committed snapshots are generated from the Zod schemas (contracts.md rule 1): a changed
  // schema fails here until `vitest -u` rewrites the snapshot in the same commit
  for (const command of Object.keys(OUTPUT_SCHEMAS)) {
    it(`FR-CLI-001: packages/cli/schemas/${command}.output.json is generated from its schema`, async () => {
      await expect(`${JSON.stringify(outputJsonSchema(command), null, 2)}\n`).toMatchFileSnapshot(`../schemas/${command}.output.json`);
    });
  }

  it('FR-CLI-001: a reply has apiVersion and ok, and either a result or errors', () => {
    const fluxion = OUTPUT_SCHEMAS['fluxion'];
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: true, exitCode: 0, result: { version: '1' } }).success).toBe(true);
    const usage = { code: 'FLX_CLI_USAGE', severity: 'error', path: '/argv', message: 'x' };
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: false, exitCode: 2, errors: [usage] }).success).toBe(true);
    // ok with errors, a failure with a result, exit code 0 on a failure, an unknown code or path: refused
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: true, exitCode: 0, errors: [] }).success).toBe(false);
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: false, exitCode: 2, result: {} }).success).toBe(false);
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: false, exitCode: 0, errors: [] }).success).toBe(false);
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: false, exitCode: 2, errors: [{ ...usage, code: 'FLX_NOPE' }] }).success).toBe(false);
    expect(fluxion?.safeParse({ apiVersion: 1, command: null, ok: false, exitCode: 2, errors: [{ ...usage, path: 'argv' }] }).success).toBe(false);
    expect(fluxion?.safeParse({ apiVersion: 2, command: null, ok: true, exitCode: 0, result: { help: '' } }).success).toBe(false);
    expect(
      OUTPUT_SCHEMAS['render']?.safeParse({ apiVersion: 1, command: 'render', ok: true, exitCode: 0, result: { out: 'a.html', screens: 2 } }).success,
    ).toBe(true);
    expect(() => outputJsonSchema('nope')).toThrow('no output schema');
  });
});
