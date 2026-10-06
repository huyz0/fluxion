// The player's chrome strings (ADR-0023, NFR-I18N-001): the global `i18n` of `@lingui/core` (no React bindings, so the one-file player stays within
// PLAYER_CORE_GZIP) with the English catalog loaded. `i18n` is a value made here, not a re-export, so a bundler cannot resolve it past this
// module and drop the loading (`sideEffects: false`); see packages/editor/src/i18n.ts.

import { catalogs } from 'virtual:fluxion/player-messages';
import { i18n as global, type I18n } from '@lingui/core';

function activated(): I18n {
  global.load(catalogs);
  if (!global.locale) global.activate('en');
  return global;
}

export const i18n: I18n = activated();
