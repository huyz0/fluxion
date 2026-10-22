// NFR-PERF-001, FR-LAY-003: the `timeline` layout on 500 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { timelineLayout } from '../src/index.js';
import { laned } from './shapes.js';
import { benchLayout } from './suite.js';

describe('timeline layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: timeline-500', async ({ bench }) => {
    await benchLayout(bench, 'timeline-500', timelineLayout, laned(500));
  });
});
