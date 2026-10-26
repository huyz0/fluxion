import type { SvgWitnessOptions, SvgWitnessSession } from '@fluxion/render/svg-witness';
import type { Browser, Page } from './svg-witness-driver.js';
import type { PreparedWitnessInput } from './svg-witness-input.js';

type ClientScript = { nonce: string; textContent: string };
export type WitnessClientState = {
  readonly document: SvgWitnessOptions['document'] & {
    readonly createElement: (name: 'script') => ClientScript;
    readonly head: { readonly append: (script: ClientScript) => void };
  };
  readonly atob: (value: string) => string;
  readonly FluxionSvgWitness: typeof import('@fluxion/render/svg-witness');
  fluxionSvgWitnessSession?: SvgWitnessSession;
};
const NONCE = 'fluxion-svg-witness-owned';
const HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${NONCE}'; frame-src 'self'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body></body></html>`;
function ensureAlive(scope: { readonly alive: () => boolean }): void {
  if (!scope.alive()) throw Error('cancelled browser initialization');
}
/** Trusted artifact and structured data stay separate; the context blocks every network route. */
export async function prepareWitnessPage(
  browser: Browser,
  input: PreparedWitnessInput,
  bundle: string,
  scope: { readonly alive: () => boolean },
): Promise<{ readonly page: Page; readonly accepted: boolean }> {
  ensureAlive(scope);
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
  try {
    ensureAlive(scope);
    await context.route('**/*', (route) => route.abort());
    ensureAlive(scope);
    const page = await context.newPage();
    ensureAlive(scope);
    await page.setContent(HTML, { timeout: 10000 });
    ensureAlive(scope);
    await page.evaluate(
      ({ code, nonce }) => {
        const client = globalThis as unknown as WitnessClientState;
        const script = client.document.createElement('script');
        script.nonce = nonce;
        script.textContent = code;
        client.document.head.append(script);
      },
      { code: bundle, nonce: NONCE },
    );
    ensureAlive(scope);
    const accepted = await page.evaluate((prepared) => {
      const client = globalThis as unknown as WitnessClientState;
      const fonts = prepared.fonts.map(({ base64, ...metadata }) => {
        const binary = client.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { ...metadata, bytes };
      });
      const made = client.FluxionSvgWitness.createSvgPaintWitness({ document: client.document, theme: prepared.theme as SvgWitnessOptions['theme'], fonts });
      if (!made.ok) return false;
      client.fluxionSvgWitnessSession = made.value;
      return true;
    }, input);
    ensureAlive(scope);
    return { page, accepted };
  } catch (cause) {
    void context.close().catch(() => {});
    throw cause;
  }
}
