// One M17 layout bench (NFR-PERF-001): the layout as the pipeline runs it (`layoutSync`: the algorithm and its post-passes), first checked to
// lay every node out, then timed. The m17 gate holds the p99 of `tree-500`, `radial-500` and `mindmap-500` to LAYOUT_500_NODES_MS.
import { expect } from 'vitest';
import { type LayoutAlgorithm, type LayoutInput, layoutSync } from '../src/index.js';

/** Vitest's bench fixture, as far as the benches use it. */
type BenchFixture = (
  name: string,
  options: { readonly async?: boolean },
  fn: () => unknown,
) => { run(options: { time: number; warmupTime: number; warmupIterations: number; iterations: number }): Promise<unknown> };

/** Time `algorithm` on `input` under `name`. */
export async function benchLayout<O>(bench: BenchFixture, name: string, algorithm: LayoutAlgorithm<O>, input: LayoutInput): Promise<void> {
  const first = layoutSync({ input, algorithm });
  if (!first.ok) throw new Error(first.error.message);
  expect(Object.keys(first.value.boxes)).toHaveLength(input.nodes.length);
  await bench(name, {}, () => layoutSync({ input, algorithm })).run({ time: 2_000, warmupTime: 0, warmupIterations: 2, iterations: 20 });
}
