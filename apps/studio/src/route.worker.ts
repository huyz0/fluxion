// The routing worker (FR-RTE-003, M16.16): runs the global routing pass on the inputs the page sends, off the page's thread. Bundled by
// Vite as its own chunk, so the player and the saved files never carry it (NFR-SIZE-005).
import { type GlobalRouteInput, globalRoutes } from '@fluxion/routing';

type Job = { readonly id: number; readonly inputs: readonly GlobalRouteInput[] };

const scope = self as unknown as { onmessage: ((event: { readonly data: Job }) => void) | null; postMessage(message: unknown): void };
scope.onmessage = ({ data }) => scope.postMessage({ id: data.id, routes: data.inputs.flatMap(globalRoutes) });
