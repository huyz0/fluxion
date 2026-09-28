import { describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../output.js';
import { fluxion } from './spawn-bin.js';

/** The reply on stdout, parsed by its command's schema (contracts.md rule 13). */
function reply(stdout: string, command = 'fluxion') {
  const parsed = OUTPUT_SCHEMAS[command]?.safeParse(JSON.parse(stdout));
  expect(parsed?.success, parsed?.error?.message).toBe(true);
  return parsed?.data as {
    readonly ok: boolean;
    readonly exitCode: number;
    readonly errors?: readonly { code: string; path: string }[];
    readonly result?: unknown;
  };
}

describe('fluxion usage (FR-CLI-001, ADR-0147)', () => {
  it('FR-CLI-001: --help lists validate and render', () => {
    const r = fluxion(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: fluxion <command>/);
    expect(r.stdout).toMatch(/^ {2}validate\s+\S/m);
    expect(r.stdout).toMatch(/^ {2}render\s+\S/m);
    expect(r.stderr).toBe('');
    // a command's own help
    const render = fluxion(['render', '--help']);
    expect(render.status).toBe(0);
    expect(render.stdout).toContain('Usage: fluxion render <file> -o <out.html>');
  });

  it('FR-CLI-001: an unknown flag exits 2', () => {
    const r = fluxion(['render', '--nope']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('FLX_CLI_USAGE');
    // with --json: one reply on stdout, valid against the render reply schema
    const json = fluxion(['render', '--nope', '--json']);
    expect(json.status).toBe(2);
    expect(reply(json.stdout, 'render')).toMatchObject({ ok: false, exitCode: 2, errors: [{ code: 'FLX_CLI_USAGE', path: '/argv' }] });
    // an unknown command, and no command at all, are usage errors too
    expect(fluxion(['frobnicate']).status).toBe(2);
    expect(fluxion([]).status).toBe(2);
  });

  it('FR-CLI-001: --version prints the version; with --json it is the result', () => {
    const r = fluxion(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('0.0.0\n');
    expect(reply(fluxion(['--version', '--json']).stdout)).toEqual({ apiVersion: 1, command: null, ok: true, exitCode: 0, result: { version: '0.0.0' } });
  });
});
