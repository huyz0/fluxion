// Subset-on-save in the studio (FR-AST-003, ADR-0051, M18.40): the setting that turns it on (off until the person turns it on), the URLs of
// the pinned engine modules, and the save's font-job runner: a fresh module Worker per font, terminated when it answers or after 30 s.
import { type FontJobWorker, type FontSubsetDeps, type FontSubsetLine, runFontSubsetJob } from '@fluxion/format';
import { plural, t } from '@lingui/core/macro';
import { type SavedBytes, webHasher } from './file-session.js';
import { localSettings } from './local-settings.js';

/** The setting that turns subsetting of embedded fonts on save on. */
export const SUBSET_FONTS_SETTING = 'fluxion.subsetFontsOnSave';

/** Whether a save subsets fonts: only when the person turned it on. */
export function subsetFontsOn(): boolean {
  return localSettings().get(SUBSET_FONTS_SETTING) === true;
}

const browserWorker = (): FontJobWorker => new Worker(new URL('./font-subset.worker.ts', import.meta.url), { type: 'module' }) as unknown as FontJobWorker;

/** The outcomes of earlier saves in this page, so an unchanged font and text are not subset again. */
const cache: NonNullable<FontSubsetDeps['cache']> = new Map();

/** What a subset-on-save needs in this page: each font job in its own worker, and the page's cache (or `outcomes`). */
export function studioSubsetDeps(spawn: () => FontJobWorker = browserWorker, outcomes: FontSubsetDeps['cache'] = cache): FontSubsetDeps {
  return { sha256: (bytes) => webHasher.sha256(bytes), ...(outcomes ? { cache: outcomes } : {}), job: (input) => runFontSubsetJob(input, spawn, globalThis) };
}

/** The line a save adds for the fonts: how many were subset and what that saved, why any stayed whole, and text a subset no longer draws. */
export function fontReportLine(report: readonly FontSubsetLine[], gaps: SavedBytes['fontGaps'] = []): string {
  const subset = report.filter((l) => l.status === 'subset');
  const saved = Math.round(subset.reduce((n, l) => n + l.before - l.after, 0) / 1024);
  const kept = report.flatMap((l) => (l.status === 'kept' ? [t`${l.name} stayed whole: ${l.message}.`] : []));
  const fonts = plural(subset.length, { one: '# font was', other: '# fonts were' });
  const done = subset.length > 0 ? t`${fonts} subset to the text they draw (${saved} KB smaller).` : '';
  const outgrown = gaps.map((g) => {
    const chars = String.fromCodePoint(...g.missing.slice(0, 8));
    return t`${g.name} was saved as a subset and does not draw “${chars}”: add the original font to draw them.`;
  });
  return [done, ...kept, ...outgrown].filter((s) => s !== '').join(' ');
}
