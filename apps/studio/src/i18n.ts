// The studio's messages (ADR-0023, NFR-I18N-001): its English catalog is loaded into the same `i18n` the editor uses (message ids are
// hashes of the text, so the two catalogs never clash). `i18n` is a value made here, not a re-export, so a bundler cannot resolve it past
// this module and drop the loading (`sideEffects: false`); see packages/editor/src/i18n.ts.

import { catalogs } from 'virtual:fluxion/studio-messages';
import { i18n as global, type I18n } from '@lingui/core';

function activated(): I18n {
  global.load(catalogs);
  global.activate('en');
  return global;
}

export const i18n: I18n = activated();
