// NFR-PERF-001, FR-LAY-003: the `force` layout on 500 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { forceLayout } from '../src/index.js';
import { graph } from './graph.js';
import { benchLayout } from './suite.js';

describe('force layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: force-500', async ({ bench }) => {
    await benchLayout(bench, 'force-500', forceLayout, graph(500));
  });
});
