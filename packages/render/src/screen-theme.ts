// The theme a screen is drawn with (FR-THM-004, ADR-0152): the record core's `screenThemeChoice` names (the screen's override,
// else its applied master's, else the document's, ADR-0054; M20.39), else the built-in light theme. A theme record that is not a
// valid theme is drawn as the light theme rather than half-styled.
import { type Store, screenThemeChoice } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { LIGHT_THEME, type Theme, themeOf } from '@fluxion/theme';
import { useMemo } from 'react';
import { useValue } from './use-value.js';

type Rec = { readonly [field: string]: unknown } | undefined;

/**
 * The theme of the screen `screenId` of `store`, following the records (a theme switch or an override restyles the screen), as
 * core's `screenThemeChoice` picks it: the screen's override, else its applied master's, else the document's (ADR-0054). The
 * caller passes `masterThemeId`, its applied master's override, so a change of it re-reads the choice.
 *
 * @public
 */
export function useScreenTheme(store: Store, screenId: RecordId, masterThemeId?: RecordId): Theme {
  const docId = store.members('byType', 'document')[0] ?? '';
  const screen = useValue(useMemo(() => store.record$(screenId), [store, screenId]));
  const doc = useValue(useMemo(() => store.record$(docId as RecordId), [store, docId]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the records that choose are the inputs; the store reads them again
  const themeId = useMemo(() => screenThemeChoice(store, screenId).themeId ?? '', [store, screenId, screen, doc, masterThemeId]);
  const record = useValue(useMemo(() => store.record$(themeId as RecordId), [store, themeId])) as Rec;
  return useMemo(() => {
    if (record === undefined || record['type'] !== 'theme') return LIGHT_THEME;
    return (
      themeOf({
        name: record['name'],
        tokens: record['tokens'],
        ...(record['defaults'] === undefined ? {} : { defaults: record['defaults'] }),
        ...(record['tableStyles'] === undefined ? {} : { tableStyles: record['tableStyles'] }),
      }) ?? LIGHT_THEME
    );
  }, [record]);
}
