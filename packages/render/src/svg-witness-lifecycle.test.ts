import type { SvgPaintRequest } from '@fluxion/format';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ownWitness } from './svg-witness-lifecycle.js';

const samples = JSON.parse(
  Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as { request: SvgPaintRequest }[];
const request = samples[0]?.request;
if (!request) throw Error('missing canonical request');
const painted = { identity: request.identity, status: 'painted' as const, fontHashes: [] };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('NFR-SEC-001: idle lifetime expiry refuses requests without initializing resources', async () => {
  const observe = vi.fn(async () => painted);
  const session = ownWitness(observe);
  await vi.advanceTimersByTimeAsync(120_000);
  expect((await session.witness(request)).status).toBe('unsupported');
  expect(observe).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: abort cancels an active observation, cleans once and prevents late ownership', async () => {
  const controller = new AbortController();
  const clean = vi.fn(),
    late = vi.fn();
  let finish: (() => void) | undefined;
  const session = ownWitness(async (r, scope) => {
    scope.own(clean);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    expect(scope.alive()).toBe(false);
    scope.own(late);
    return { ...painted, identity: r.identity };
  }, controller.signal);
  const pending = session.witness(request);
  controller.abort();
  expect((await pending).status).toBe('unsupported');
  expect(clean).toHaveBeenCalledTimes(1);
  finish?.();
  await Promise.resolve();
  expect(late).toHaveBeenCalledTimes(1);
  session.dispose();
  expect(clean).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: busy refusal preserves the active request and its resources', async () => {
  let finish: (() => void) | undefined;
  const clean = vi.fn();
  const session = ownWitness(async (_r, scope) => {
    scope.own(clean);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    expect(scope.alive()).toBe(true);
    return painted;
  });
  const first = session.witness(request);
  expect((await session.witness(request)).status).toBe('unsupported');
  expect(clean).not.toHaveBeenCalled();
  finish?.();
  expect(await first).toEqual(painted);
  expect(clean).toHaveBeenCalledTimes(1);
  session.dispose();
});
it('NFR-SEC-001: initialization is inside the ten-second deadline and late results cannot publish', async () => {
  const clean = vi.fn();
  const session = ownWitness(async (_r, scope) => {
    scope.own(clean);
    await new Promise(() => {});
    return painted;
  });
  const pending = session.witness(request);
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await pending).status).toBe('unsupported');
  expect(clean).toHaveBeenCalledTimes(1);
  expect((await session.witness(request)).status).toBe('unsupported');
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: lifetime expiry during observation takes precedence over request deadline', async () => {
  const session = ownWitness(async () => {
    await new Promise(() => {});
    return painted;
  });
  await vi.advanceTimersByTimeAsync(119_000);
  const pending = session.witness(request);
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await pending).status).toBe('unsupported');
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: 128 admitted observations finish, invalid requests do not consume capacity', async () => {
  const observe = vi.fn(async () => painted);
  const session = ownWitness(observe);
  expect((await session.witness({ ...request, width: 1 })).status).toBe('unsupported');
  for (let i = 0; i < 128; i++) expect(await session.witness(request)).toEqual(painted);
  expect((await session.witness(request)).status).toBe('unsupported');
  expect(observe).toHaveBeenCalledTimes(128);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: initialization failure cleans resources and disposal is idempotent', async () => {
  const clean = vi.fn();
  const session = ownWitness(async (_r, scope) => {
    scope.own(clean);
    throw Error('initialization failed');
  });
  expect((await session.witness(request)).status).toBe('unsupported');
  expect(clean).toHaveBeenCalledTimes(1);
  session.dispose();
  session.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
