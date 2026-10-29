// FR-LIB-004: any batch up to its 4096-entry cap is witnessed through successive sessions of at most 128 requests and 90 s each
// (ADR-0189, M18.174), on the host's clock; a session that cannot start or close is reported, and no later request is painted.
import { err, ok } from '@fluxion/schema';
import { expect, it, vi } from 'vitest';
import { SESSION_AGE_MS, SESSION_REQUESTS, type SvgPaintRequest, witnessSessions } from './index.js';

const request = (i: number) => ({ identity: `r${i}`, fonts: [] }) as unknown as SvgPaintRequest;

/** A start port whose sessions refuse past 128 requests, as the witnesses do; `fail` makes the nth start or dispose fail. */
function host(fail: { start?: number; dispose?: number } = {}) {
  const log: string[] = [];
  let starts = 0;
  let disposals = 0;
  const start = vi.fn(async () => {
    const n = ++starts;
    if (n === fail.start) return err('start');
    let used = 0;
    return ok({
      witness: async (r: SvgPaintRequest) => {
        log.push(`${n}:${r.identity}`);
        return { identity: r.identity, status: ++used > SESSION_REQUESTS ? ('unsupported' as const) : ('painted' as const), fontHashes: [] };
      },
      dispose: async () => (++disposals === fail.dispose ? err('cleanup') : ok(undefined)),
    });
  });
  return { start, log, disposals: () => disposals };
}

const opened = async (start: Parameters<typeof witnessSessions<string>>[0], now: () => number = () => 0) => {
  const sessions = await witnessSessions(start, now);
  if (!sessions.ok) throw new Error('no session');
  return sessions.value;
};

it('FR-LIB-004: 300 requests are witnessed by three sessions of at most 128, each disposed', async () => {
  const h = host();
  const sessions = await opened(h.start);
  const receipts = [];
  for (let i = 0; i < 300; i++) receipts.push(await sessions.witness(request(i)));
  await sessions.dispose();
  expect(receipts.every((r) => r.status === 'painted')).toBe(true);
  expect(h.start).toHaveBeenCalledTimes(3);
  expect(h.disposals()).toBe(3);
  expect([h.log[127], h.log[128], h.log[256]]).toEqual(['1:r127', '2:r128', '3:r256']);
  expect(sessions.failure()).toBeUndefined();
});

it('FR-LIB-004: a session is replaced once 90 s old on the injected clock, its age counted from before it started', async () => {
  const h = host();
  let clock = 0;
  const slow = async () => {
    const s = await h.start();
    clock += 30_000;
    return s;
  };
  const sessions = await opened(slow, () => clock);
  clock += SESSION_AGE_MS - 30_000 - 1;
  await sessions.witness(request(0));
  clock += 1;
  await sessions.witness(request(1));
  expect(h.log).toEqual(['1:r0', '2:r1']);
});

it('FR-LIB-004: a later start or a cleanup that fails is the failure, and no later request is painted', async () => {
  for (const fail of [{ start: 2 }, { dispose: 1 }]) {
    const sessions = await opened(host(fail).start);
    const statuses = [];
    for (let i = 0; i < 130; i++) statuses.push((await sessions.witness(request(i))).status);
    await sessions.dispose();
    expect(statuses.slice(128)).toEqual(['unsupported', 'unsupported']);
    expect(sessions.failure()).toBe(fail.start ? 'start' : 'cleanup');
  }
  expect(await witnessSessions(host({ start: 1 }).start, () => 0)).toEqual({ ok: false, error: 'start' });
});
