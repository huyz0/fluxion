import { describe, expect, it } from 'vitest';
import { CaptureLogger, FixedTextMeasurer, MemoryFileIO, seededRandom, VirtualClock } from './index.js';

describe('@fluxion/core/testing port fakes (NFR-REL-005)', () => {
  it('NFR-REL-005: seeded Random yields the same sequence across runs', () => {
    const draw = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 100 }, () => random.next());
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
    expect(draw(7).every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('NFR-REL-005: VirtualClock only advances when told and runs the frames then due', () => {
    const clock = new VirtualClock(100);
    const seen: number[] = [];
    clock.frame((t) => seen.push(t));
    const cancel = clock.frame((t) => seen.push(-t));
    cancel();
    expect(clock.now()).toBe(100);
    expect(seen).toEqual([]);
    clock.advance(16);
    expect(clock.now()).toBe(116);
    expect(seen).toEqual([116]);
    // a frame requested during a frame runs on the next advance, not the current one
    clock.frame(() => clock.frame((t) => seen.push(t)));
    clock.advance(16);
    expect(seen).toEqual([116]);
    clock.advance(16);
    expect(seen).toEqual([116, 148]);
  });

  it('FixedTextMeasurer is a pure function of text and font', () => {
    const m = new FixedTextMeasurer();
    expect(m.measure('ab\nabcd', { family: 'x', size: 10 })).toEqual({ width: 24, height: 24, ascent: 8, descent: 2 });
    expect(m.measure('ab\nabcd', { family: 'x', size: 10, lineHeight: 1 }).height).toBe(20);
  });

  it('MemoryFileIO returns copies and FILE_NOT_FOUND for a missing path', async () => {
    const io = new MemoryFileIO();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await io.write('a.bin', bytes)).toEqual({ ok: true, value: undefined });
    bytes[0] = 9;
    const read = await io.read('a.bin');
    expect(read.ok && [...read.value]).toEqual([1, 2, 3]);
    expect(await io.read('b.bin')).toEqual({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'no file at b.bin' } });
  });

  it('CaptureLogger keeps every entry in order', () => {
    const logger = new CaptureLogger();
    logger.log('info', 'a');
    logger.log('warn', 'b', { n: 1 });
    expect(logger.entries).toEqual([
      { level: 'info', message: 'a' },
      { level: 'warn', message: 'b', fields: { n: 1 } },
    ]);
  });
});
