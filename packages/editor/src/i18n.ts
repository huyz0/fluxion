// The editor's messages (ADR-0023, NFR-I18N-001): one `i18n` instance with the English catalog loaded. The catalog is
// `locales/en/messages.json`, compiled to ICU tokens by the repository's Lingui plugin (`tools/vite-lingui`), so no ICU parser ships.

import { catalogs } from 'virtual:fluxion/editor-messages';
import { i18n } from '@lingui/core';

i18n.load(catalogs);
i18n.activate('en');

export { i18n };
