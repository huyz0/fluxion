// NFR-PERF-001, FR-LAY-003: the `tree` layout on 100 nodes, as the pipeline runs it (bench/suite.ts).
import { describe, test } from 'vitest';
import { treeLayout } from '../src/index.js';
import { tree } from './shapes.js';
import { benchLayout } from './suite.js';

describe('tree layout (NFR-PERF-001)', () => {
  test('NFR-PERF-001: tree-100', async ({ bench }) => {
    await benchLayout(bench, 'tree-100', treeLayout, tree(100));
  });
});
