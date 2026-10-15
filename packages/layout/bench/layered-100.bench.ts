// NFR-PERF-005 (layout part): a 100-node `layered` layout through the whole pipeline (validate, dagre, pins, overlap, snap, fingerprint); the
// M13 gate's bench leg holds the p99 of `layered-100` to LAYOUT_100_NODES_MS and to 15 % over perf-baseline.json.
import { describe, expect, test } from 'vitest';
import { layeredLayout, layoutSync } from '../src/index.js';
import { graph } from './graph.js';

describe('layered layout (NFR-PERF-005)', () => {
  test('NFR-PERF-005: layered-100', async ({ bench }) => {
    const input = graph(100);
    const first = layoutSync({ input, algorithm: layeredLayout });
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.metrics.overlaps).toBe(0);
    await bench('layered-100', { async: false }, () => {
      layoutSync({ input, algorithm: layeredLayout });
    }).run({ time: 3_000, warmupTime: 500 });
  });
});
