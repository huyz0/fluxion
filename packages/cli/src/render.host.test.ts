import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CliIo } from './command.js';
import { run } from './main.js';

// a bundled pack that fails to register: the CLI's own fault (ADR-0017), whatever the input
vi.mock('./host.js', () => ({
  hostRegistries: () => ({ registries: {}, problems: [{ code: 'FLX_PACK_INVALID', severity: 'error', path: '/id', message: 'pack "basic": broken' }] }),
}));

const dir = mkdtempSync(join(tmpdir(), 'fluxion-host-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('render with the bundled packs (ADR-0017)', () => {
  it('FR-EXT-001: a bundled pack that fails to register is an internal error, before the input is read', async () => {
    const out: string[] = [];
    const io: CliIo = { stdout: (t) => out.push(t), stderr: () => undefined };
    const file = join(dir, 'missing.flux.json');
    const code = await run(['render', file, '-o', join(dir, 'out.html'), '--json'], io);
    expect(code).toBe(3);
    expect(JSON.parse(out.join('')).errors).toMatchObject([{ code: 'FLX_CLI_INTERNAL', message: 'pack "basic": broken' }]);
  });
});
