// The snapping toggle's persistence (FR-ARR-005, M8.10): the session starts with the stored choice (on when none) and
// every change is stored again, so the setting outlives a reload.
import { useValue } from '@fluxion/render';
import { useEffect, useState } from 'react';
import type { Session } from '../session.js';
import type { SettingsStore } from '../settings.js';

/** Where the snapping choice is kept. */
export const SNAP_KEY = 'fluxion.editor.snap.v1';

/** Keep `session.snap` and the `settings` entry in step. */
export function useSnapSetting(settings: SettingsStore, session: Session): void {
  useState(() => session.snap.set(settings.get(SNAP_KEY) !== false));
  const on = useValue(session.snap.get);
  useEffect(() => settings.set(SNAP_KEY, on), [settings, on]);
}
