// NFR-PERF-001, FR-LAY-003: the `circular` layout on 100 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { circularLayout } from '../src/index.js';
import { graph } from './graph.js';
import { benchLayout } from './suite.js';

describe('circular layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: circular-100', async ({ bench }) => {
    await benchLayout(bench, 'circular-100', circularLayout, graph(100));
  });
});
