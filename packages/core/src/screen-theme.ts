// Which theme a screen is drawn with (FR-THM-004, ADR-0152, ADR-0054): the one rule render, the dsl contrast rule, the editor's
// theme editor and the exporters read (M20.39, cp4 F2), so none of them can drift from what the view draws.
import type { RecordId } from '@fluxion/schema';
import { appliedMaster } from './masters.js';
import type { ReadView } from './store.js';

/**
 * The theme a screen is drawn with: `themeId`, the theme record id named by `holder`, the first record in order that names one
 * (the screen's own override, else its applied master's, else the document's). With none named, `holder` is the document and
 * `themeId` undefined (the view draws the built-in light theme, as it does for an id that names no valid theme record).
 *
 * @public
 */
export type ScreenThemeChoice = {
  /** The record whose `themeId` chose the theme: the screen, its applied master, or the document; undefined without a document. */
  readonly holder: RecordId | undefined;
  /** The theme record id that record names; undefined when none of them names one. */
  readonly themeId: RecordId | undefined;
};

const named = (view: ReadView, id: RecordId | undefined): RecordId | undefined => {
  const themeId = id === undefined ? undefined : (view.get(id) as { themeId?: unknown } | undefined)?.themeId;
  return typeof themeId === 'string' ? (themeId as RecordId) : undefined;
};

/**
 * The theme choice of screen `screenId` in `view` (ADR-0152, ADR-0054): its `themeId`, else its applied master's, else the
 * document's. A screen id that names no screen (or none given) falls to the document.
 *
 * @example
 * ```ts
 * const { themeId } = screenThemeChoice(store, screenId);
 * const record = themeId === undefined ? undefined : store.get(themeId);
 * ```
 * @public
 */
export function screenThemeChoice(view: ReadView, screenId: RecordId | undefined): ScreenThemeChoice {
  const screen = screenId !== undefined && view.get(screenId)?.type === 'screen' ? screenId : undefined;
  const master = screen === undefined ? undefined : appliedMaster(view, screen).master;
  const document = view.members('byType', 'document')[0] as RecordId | undefined;
  for (const holder of [screen, master, document]) {
    const themeId = named(view, holder);
    if (themeId !== undefined) return { holder, themeId };
  }
  return { holder: document, themeId: undefined };
}
