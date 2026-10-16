import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterAll, describe, expect, it } from 'vitest';
import type { CliIo, Command } from '../command.js';
import { runCommands } from '../main.js';
import { E2E_TIMEOUT, fluxion } from './spawn-bin.js';

const b = documentBuilder({ seed: 14 });
b.rect(b.screen(), { x: 0, y: 0, w: 100, h: 50 });
const VALID = serializeDocument(b.build());

describe('the exit-code matrix (FR-CLI-005, ADR-0036)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-exit-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, text: string) => {
    const file = join(dir, name);
    writeFileSync(file, text);
    return file;
  };

  it('FR-CLI-005: a valid document exits 0', { timeout: E2E_TIMEOUT }, () => {
    const r = fluxion(['validate', write('ok.flux.json', VALID), '--json']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('FR-CLI-005: an invalid document and an unreadable file exit 1', { timeout: E2E_TIMEOUT }, () => {
    const bad = fluxion(['validate', write('bad.flux.json', '{"not":"a document"}'), '--json']);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, exitCode: 1 });
    const missing = fluxion(['validate', join(dir, 'absent.flux.json'), '--json']);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).errors[0].code).toBe('FLX_CLI_IO');
  });

  it('FR-CLI-005: a bad flag and an unknown command exit 2', { timeout: E2E_TIMEOUT }, () => {
    const flag = fluxion(['validate', '--frobnicate', '--json']);
    expect(flag.status).toBe(2);
    expect(JSON.parse(flag.stdout).errors[0].code).toBe('FLX_CLI_USAGE');
    expect(fluxion(['nonsense']).status).toBe(2);
  });

  it('FR-CLI-005: a crash exits 3 with FLX_CLI_INTERNAL and nothing else on stdout', async () => {
    const crash: Command = {
      summary: 'always throws',
      usage: 'crash',
      options: {},
      run: () => {
        throw new Error('injected crash');
      },
    };
    const out: string[] = [];
    const io: CliIo = { stdout: (t) => out.push(t), stderr: () => undefined };
    expect(await runCommands({ validate: crash }, ['validate', '--json'], io)).toBe(3);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toMatchObject({ ok: false, exitCode: 3, errors: [{ code: 'FLX_CLI_INTERNAL', message: 'injected crash' }] });
  });

  it('FR-CLI-005: the operation layer is a separate entry that holds no node:fs', async () => {
    const ops = await import('../ops/index.js');
    expect(ops.validateDocument('not json').ok).toBe(false);
    expect(ops.validateDocument(VALID).ok).toBe(true);
    for (const file of readdirSync(new URL('../ops/', import.meta.url)).filter((f) => f.endsWith('.ts')))
      expect(readFileSync(new URL(`../ops/${file}`, import.meta.url), 'utf8'), file).not.toMatch(/from 'node:/);
  });
});
