// The editor's messages (ADR-0023, NFR-I18N-001): the global `i18n` with the English catalog loaded. The catalog is
// `locales/en/messages.json`, compiled to ICU tokens by the repository's Lingui plugin (`tools/vite-lingui`), so no ICU parser ships.
// `i18n` is a value made here, not a re-export: a bundler that resolves a re-export straight to `@lingui/core` would drop this module's
// side effects (`sideEffects: false`) and ship an instance with no locale.

import { catalogs } from 'virtual:fluxion/editor-messages';
import { i18n as global, type I18n } from '@lingui/core';

function activated(): I18n {
  global.load(catalogs);
  global.activate('en');
  return global;
}

export const i18n: I18n = activated();
