import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { E2E_TIMEOUT, fluxion } from './spawn-bin.js';

const b = documentBuilder({ seed: 17 });
b.rect(b.screen({ size: { w: 320, h: 200 } }), { x: 10, y: 10, w: 100, h: 50 });

const dir = mkdtempSync(join(tmpdir(), 'fluxion-png-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, 'doc.flux.json');
writeFileSync(file, serializeDocument(b.build()));

describe('fluxion render --format png (FR-AI-006, ADR-0036)', () => {
  it('FR-AI-006: fluxion render --json writes one PNG per screen at the size of the screen', { timeout: 60_000 }, () => {
    const out = join(dir, 'shots');
    const r = fluxion(['render', file, '--format', 'png', '-o', out, '--json']);
    expect(JSON.parse(r.stdout), r.stdout).toMatchObject({ ok: true, exitCode: 0, result: { screens: 1 } });
    const names = readdirSync(out);
    expect(names).toHaveLength(1);
    const png = readFileSync(join(out, names[0] as string));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    // the IHDR chunk: width then height, one pixel per unit
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 200]);
  });

  it('FR-AI-006: without a browser the reply is FLX_CLI_PEER_MISSING, exit 2', { timeout: E2E_TIMEOUT }, () => {
    const empty = join(dir, 'no-browsers');
    const r = fluxion(['render', file, '--format', 'png', '-o', join(dir, 'none'), '--json'], undefined, { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).errors[0]).toMatchObject({ code: 'FLX_CLI_PEER_MISSING' });
  });

  it('FR-AI-006: another format is FLX_CLI_FORMAT_UNSUPPORTED, exit 2', { timeout: E2E_TIMEOUT }, () => {
    const r = fluxion(['render', file, '--format', 'gif', '-o', join(dir, 'x'), '--json']);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).errors[0].code).toBe('FLX_CLI_FORMAT_UNSUPPORTED');
  });
});
