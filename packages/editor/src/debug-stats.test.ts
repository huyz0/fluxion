import { describe, expect, it } from 'vitest';
import { DebugStats, fpsOf } from './debug-stats.js';

describe('the debug stats (NFR-OBS-001)', () => {
  it('NFR-OBS-001: counters add up, timings give count, mean and max, and reset forgets them', () => {
    const stats = new DebugStats();
    stats.count('renders');
    stats.count('renders');
    stats.time('route', 2);
    stats.time('route', 6);
    expect(stats.snapshot()).toEqual({ counts: { renders: 2 }, timings: { route: { count: 2, mean: 4, max: 6 } } });
    stats.reset();
    expect(stats.snapshot()).toEqual({ counts: {}, timings: {} });
  });

  it('NFR-OBS-001: the frame rate is the frames in the span they cover, and 0 without two frames', () => {
    expect(fpsOf([])).toBe(0);
    expect(fpsOf([5])).toBe(0);
    expect(fpsOf([5, 5])).toBe(0);
    // 61 frames 1000 / 60 ms apart cover one second
    const frames = Array.from({ length: 61 }, (_, i) => (i * 1000) / 60);
    expect(fpsOf(frames)).toBeCloseTo(60, 5);
    expect(fpsOf([0, 50, 100])).toBe(20);
  });
});
