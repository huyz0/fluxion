import type { JSX } from 'react';

/**
 * The studio shell. A blank page until the editor and player land (M6).
 *
 * @public
 */
export function App(): JSX.Element {
  return (
    <main data-testid="studio-root">
      <h1>Fluxion Studio</h1>
    </main>
  );
}
