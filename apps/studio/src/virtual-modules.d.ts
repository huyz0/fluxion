// The catalog the Lingui plugin serves (tools/vite-lingui): `{ <locale>: { <message id>: compiled message } }`.
declare module 'virtual:fluxion/studio-messages' {
  import type { Messages } from '@lingui/core';
  export const catalogs: Record<string, Messages>;
}
