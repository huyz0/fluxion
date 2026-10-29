// FR-LIB-004: `pack-import` witnesses any batch up to its 4096-entry cap through successive Node sessions (128 requests and 120 s
// each, ADR-0189); a session that cannot start or close is reported, and no later request is answered as painted.
import type { SvgPaintRequest } from '@fluxion/format';
import { err, ok } from '@fluxion/schema';
import { expect, it, vi } from 'vitest';
import { SESSION_AGE_MS, SESSION_REQUESTS, witnessSessions } from './pack-import-sessions.js';
import type { NodeSvgWitnessFailure } from './svg-witness-types.js';

const request = (i: number) => ({ identity: `r${i}`, fonts: [] }) as unknown as SvgPaintRequest;
const failure = (kind: NodeSvgWitnessFailure['kind']): NodeSvgWitnessFailure => ({
  kind,
  diagnostics: [{ code: 'FLX_CLI_IO', severity: 'error', path: '', message: kind }],
});

/** A start port whose sessions refuse past 128 requests, as the Node witness does; `fail` makes the nth start or dispose fail. */
function host(fail: { start?: number; dispose?: number } = {}) {
  const log: string[] = [];
  let starts = 0;
  let disposals = 0;
  const start = vi.fn(async () => {
    const n = ++starts;
    if (n === fail.start) return err(failure('peer-missing'));
    let used = 0;
    return ok({
      witness: async (r: SvgPaintRequest) => {
        log.push(`${n}:${r.identity}`);
        return { identity: r.identity, status: ++used > SESSION_REQUESTS ? ('unsupported' as const) : ('painted' as const), fontHashes: [] };
      },
      observe: async () => err(failure('unsupported')),
      dispose: async () => (++disposals === fail.dispose ? err(failure('cleanup')) : ok(undefined)),
    });
  });
  return { start, log, disposals: () => disposals };
}

it('FR-LIB-004: 300 requests are witnessed by three sessions of at most 128, each disposed', async () => {
  const h = host();
  const sessions = await witnessSessions(h.start);
  if ('kind' in sessions) throw new Error('no session');
  const receipts = [];
  for (let i = 0; i < 300; i++) receipts.push(await sessions.witness(request(i)));
  await sessions.dispose();
  expect(receipts.every((r) => r.status === 'painted')).toBe(true);
  expect(h.start).toHaveBeenCalledTimes(3);
  expect(h.disposals()).toBe(3);
  expect([h.log[127], h.log[128], h.log[256]]).toEqual(['1:r127', '2:r128', '3:r256']);
  expect(sessions.failure()).toBeUndefined();
});

it('FR-LIB-004: a session is replaced once 90 s old, inside its 120 s lifetime', async () => {
  const h = host();
  let clock = 0;
  const sessions = await witnessSessions(h.start, () => clock);
  if ('kind' in sessions) throw new Error('no session');
  await sessions.witness(request(0));
  clock = SESSION_AGE_MS;
  await sessions.witness(request(1));
  expect(h.log).toEqual(['1:r0', '2:r1']);
});

it("FR-LIB-004: a session's age counts its launch: one that took 30 s to start is replaced 60 s after it started answering", async () => {
  const h = host();
  let clock = 0;
  const slow = async () => {
    const s = await h.start();
    clock += 30_000;
    return s;
  };
  const sessions = await witnessSessions(slow, () => clock);
  if ('kind' in sessions) throw new Error('no session');
  clock += SESSION_AGE_MS - 30_000 - 1;
  await sessions.witness(request(0));
  clock += 1;
  await sessions.witness(request(1));
  expect(h.log).toEqual(['1:r0', '2:r1']);
});

it('FR-LIB-004: a later start or a cleanup that fails is the failure, and no later request is painted', async () => {
  for (const fail of [{ start: 2 }, { dispose: 1 }]) {
    const h = host(fail);
    const sessions = await witnessSessions(h.start);
    if ('kind' in sessions) throw new Error('no session');
    const statuses = [];
    for (let i = 0; i < 130; i++) statuses.push((await sessions.witness(request(i))).status);
    await sessions.dispose();
    expect(statuses.slice(128)).toEqual(['unsupported', 'unsupported']);
    expect(sessions.failure()?.kind).toBe(fail.start ? 'peer-missing' : 'cleanup');
  }
  const first = await witnessSessions(host({ start: 1 }).start);
  expect('kind' in first && first.kind).toBe('peer-missing');
});
