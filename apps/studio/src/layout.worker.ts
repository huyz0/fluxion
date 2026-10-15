// The layout worker (FR-LAY-007, M13.30): the module the studio starts with `new Worker`. It answers layout jobs with the built-in algorithms; the
// document stays on the page's thread, only the snapshot goes in and the boxes come out. Bundled by Vite as its own chunk, so the player and the
// saved files never carry it (NFR-SIZE-005).
import { gridLayout, layeredLayout, stackLayout } from '@fluxion/layout';
import { serveLayoutWorker, type WorkerScopeLike } from '@fluxion/layout/worker';

const algorithms = new Map([gridLayout, layeredLayout, stackLayout].map((a) => [a.id, a] as const));

serveLayoutWorker(self as unknown as WorkerScopeLike, (name) => algorithms.get(name) as never);
