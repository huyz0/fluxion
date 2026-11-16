// Boot phases (M19.29): the studio marks each step between a page load and the editor's first screen on the page's performance
// timeline, so a slow or stalled first screen says where it stopped. A spec that times out waiting for the first screen reads
// them (e2e/pages/editor.ts), as does anyone with the browser's performance panel.

/**
 * A step of the studio's boot: the module ran, the document lock answered, the document's packs and the first-party pack connectors
 * are registered, the editor mounted.
 *
 * @public
 */
export type BootPhase = 'start' | 'lock' | 'packs' | 'editor';

/** The name a phase is marked under on the performance timeline. */
export const bootMarkName = (phase: BootPhase): string => `fluxion:boot:${phase}`;

/**
 * Mark `phase` on the page's performance timeline, once per page: a StrictMode remount or a second document does not mark it again.
 * Nothing where the page has no performance timeline.
 *
 * @public
 */
export function bootMark(phase: BootPhase, timeline: Pick<Performance, 'mark' | 'getEntriesByName'> | undefined = globalThis.performance): void {
  if (timeline === undefined) return;
  const name = bootMarkName(phase);
  if (timeline.getEntriesByName(name, 'mark').length === 0) timeline.mark(name);
}
