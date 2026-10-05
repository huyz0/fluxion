// The theme a screen is drawn with (FR-THM-004, ADR-0152): its own override (`screen.themeId`) else the document's
// (`document.themeId`), read from the `theme` record, else the built-in light theme. A theme record that is not a valid
// theme is drawn as the light theme rather than half-styled.
import type { Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { LIGHT_THEME, type Theme, themeOf } from '@fluxion/theme';
import { useMemo } from 'react';
import { useValue } from './use-value.js';

type Rec = { readonly [field: string]: unknown } | undefined;

/**
 * The theme of the screen `screenId` of `store`, following the records (a theme switch or an override restyles the screen).
 *
 * @public
 */
export function useScreenTheme(store: Store, screenId: RecordId): Theme {
  const docId = store.members('byType', 'document')[0] ?? '';
  const screen = useValue(useMemo(() => store.record$(screenId), [store, screenId])) as Rec;
  const doc = useValue(useMemo(() => store.record$(docId as RecordId), [store, docId])) as Rec;
  const themeId = (typeof screen?.['themeId'] === 'string' ? screen['themeId'] : undefined) ?? (typeof doc?.['themeId'] === 'string' ? doc['themeId'] : '');
  const record = useValue(useMemo(() => store.record$(themeId as RecordId), [store, themeId])) as Rec;
  return useMemo(() => {
    if (record === undefined || record['type'] !== 'theme') return LIGHT_THEME;
    return (
      themeOf({
        name: record['name'],
        tokens: record['tokens'],
        ...(record['defaults'] === undefined ? {} : { defaults: record['defaults'] }),
      }) ?? LIGHT_THEME
    );
  }, [record]);
}
