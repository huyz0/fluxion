// Where the views report how long their work took (NFR-OBS-001): a host that shows a debug overlay provides a recorder, and a connector view times its route with it.
// Without a provider nothing is measured, and the views draw exactly as before.
import { type Context, createContext } from 'react';

/**
 * Records that the work `name` took `ms` milliseconds.
 *
 * @public
 */
export type RenderStatsRecorder = (name: string, ms: number) => void;

/**
 * The recorder the views report to; absent (the default) means nothing is timed.
 *
 * @public
 */
export const RenderStatsContext: Context<RenderStatsRecorder | undefined> = createContext<RenderStatsRecorder | undefined>(undefined);
