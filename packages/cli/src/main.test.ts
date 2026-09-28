import { describe, expect, it } from 'vitest';
import { type CliIo, type Command, run, runCommands } from './main.js';
import { OUTPUT_SCHEMAS } from './output.js';

/** Runs the CLI in-process (optionally over its own command table), capturing what it writes. */
async function cli(argv: readonly string[], commands?: { readonly [name: string]: Command }) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
  const code = await (commands ? runCommands(commands, argv, io) : run(argv, io));
  return { code, stdout: out.join(''), stderr: err.join('') };
}

const json = (stdout: string) => JSON.parse(stdout);

describe('run (FR-CLI-001, ADR-0147)', () => {
  it('FR-CLI-001: help, version and usage errors map to exit codes 0 and 2', async () => {
    expect((await cli(['--help'])).code).toBe(0);
    expect((await cli(['-h'])).stdout).toContain('Commands:');
    expect((await cli(['--version'])).stdout).toBe('0.0.0\n');
    const none = await cli([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toBe('error FLX_CLI_USAGE /argv: no command given (Run fluxion --help.)\n');
    // the unknown command's position is the diagnostic path
    const unknown = await cli(['--json', 'frobnicate']);
    expect(unknown.code).toBe(2);
    expect(json(unknown.stdout).errors[0]).toMatchObject({ code: 'FLX_CLI_USAGE', path: '/argv/1', message: 'unknown command "frobnicate"' });
    // a missing option value is a usage error
    expect((await cli(['render', 'a.json', '-o'])).code).toBe(2);
  });

  it('FR-CLI-001: --json prints exactly one reply on stdout, valid against its schema, even for help', async () => {
    for (const argv of [
      ['--help', '--json'],
      ['render', '--help', '--json'],
      ['validate', 'x', '--json'],
    ]) {
      const r = await cli(argv);
      const lines = r.stdout.trimEnd().split('\n');
      expect(lines, argv.join(' ')).toHaveLength(1);
      const reply = json(lines[0] as string);
      expect(OUTPUT_SCHEMAS[reply.command ?? 'fluxion']?.safeParse(reply).success, argv.join(' ')).toBe(true);
    }
    expect(json((await cli(['render', '--help', '--json'])).stdout).result.help).toContain('fluxion render');
  });

  it('FR-CLI-001: options after -- are positionals; --version works after a command (M4.17 review F3)', async () => {
    // "--json" after the terminator is a file name, not the output mode
    const literal = await cli(['validate', 'x', '--', '--json']);
    expect(literal.stdout).toBe('');
    expect(literal.code).toBe(3);
    expect((await cli(['render', '--version'])).stdout).toBe('0.0.0\n');
    expect(json((await cli(['render', '--version', '--json'])).stdout)).toMatchObject({ command: 'render', ok: true, result: { version: '0.0.0' } });
  });

  it('FR-CLI-001: a command not available yet, or one that throws, is an internal error that keeps its name (review F4)', async () => {
    const r = await cli(['validate', 'doc.flux.json']);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('not available');
    const throwing: Command = {
      summary: 's',
      usage: 'validate',
      options: {},
      run: () => {
        throw new Error('boom');
      },
    };
    const crashed = await cli(['validate', '--json'], { validate: throwing });
    expect(crashed.code).toBe(3);
    expect(crashed.stderr).toContain('internal error: boom');
    expect(json(crashed.stdout)).toEqual({ apiVersion: 1, command: 'validate', ok: false, exitCode: 3, errors: [] });
  });

  it('FR-CLI-001: a reply outside its schema is reported as an internal error, with a reply that conforms', async () => {
    const bad: Command = { summary: 's', usage: 'render', options: {}, run: () => ({ exitCode: 0, diagnostics: [], result: { unexpected: true } }) };
    const r = await cli(['render', '--json'], { render: bad });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('does not match its schema');
    expect(OUTPUT_SCHEMAS['render']?.safeParse(json(r.stdout)).success).toBe(true);
  });
});
