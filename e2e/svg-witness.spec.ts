import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { SvgPaintRequest } from '../packages/format/src/svg-import-types.js';
import { LIGHT_THEME } from '../packages/theme/src/light.js';
import { domFreeAliases } from '../tools/vite-dom-free/index.mjs';
import { expect, test } from './test.js';

let bundle: string;
const samples = JSON.parse(readFileSync('packages/format/src/__fixtures__/svg-paint-requests.json', 'utf8')) as readonly {
  name: string;
  request: SvgPaintRequest;
}[];
const fontBytes = Array.from(readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
const firstRequest = samples[0]?.request;
if (!firstRequest) throw Error('missing canonical request');
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    resolve: { conditions: ['@fluxion/source', 'module', 'browser'], alias: domFreeAliases },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { write: false, minify: false, lib: { entry: resolve('packages/render/src/svg-witness.ts'), name: 'FluxionWitness', formats: ['iife'] } },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!output || !('output' in output)) throw Error('missing bundled witness');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk) throw Error('missing witness chunk');
  bundle = chunk.code;
});
test('FR-LIB-004: the production browser entry observes bounded artwork without network @desktop', async ({ page, blocked }) => {
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle });
  const receipts = await page.evaluate(
    async ({ theme, requests, fontBytes }) => {
      const api = (window as unknown as { FluxionWitness: typeof import('../packages/render/src/svg-witness.js') }).FluxionWitness;
      const faces = requests.flatMap((r) => r.fonts).filter((f, i, all) => all.findIndex((other) => other.family === f.family) === i);
      const fonts = faces.map((f) => ({ ...f, profile: 'inter-latin-400-ascii' as const, bytes: new Uint8Array(fontBytes) }));
      const made = api.createSvgPaintWitness({ document, theme, fonts });
      if (!made.ok) throw Error('witness construction failed');
      try {
        const receipts = [];
        for (const request of requests) receipts.push(await made.value.witness(request));
        return receipts;
      } finally {
        made.value.dispose();
      }
    },
    { theme: LIGHT_THEME, requests: samples.map((sample) => sample.request), fontBytes },
  );
  expect(receipts).toEqual(samples.map(({ request }) => ({ identity: request.identity, status: 'painted', fontHashes: request.fonts.map((f) => f.sha256) })));
  expect(await page.locator('[data-fluxion-svg-witness]').count()).toBe(0);
  expect(blocked).toEqual([]);
});
test('NFR-SEC-001: frame CSP prevents remote network dispatch and identifies blocked attempts @desktop', async ({ page, blocked }) => {
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle });
  const policyMessages: string[] = [];
  page.on('console', (message) => policyMessages.push(message.text()));
  const network: string[] = [];
  const failures: { url: string; reason: string }[] = [];
  const responses: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('https://witness.invalid')) failures.push({ url: request.url(), reason: request.failure()?.errorText ?? '' });
  });
  page.on('response', (response) => {
    if (response.url().startsWith('https://witness.invalid')) responses.push(response.url());
  });
  page.on('request', (request) => {
    if (request.url().startsWith('https://witness.invalid')) network.push(request.url());
  });
  const result = await page.evaluate(
    async ({ theme, request }) => {
      const violations: string[] = [];
      const attempts: string[] = [];
      let observedBeforeMount = false;
      const originalCreate = document.createElement;
      const previousCreate = Object.getOwnPropertyDescriptor(document, 'createElement');
      function qualifies(frame: HTMLIFrameElement): boolean {
        const policy =
          "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
        return (
          frame.isConnected &&
          frame.hasAttribute('data-fluxion-svg-witness') &&
          frame.getAttribute('sandbox') === 'allow-same-origin' &&
          frame.contentDocument?.querySelector('meta')?.getAttribute('content') === policy
        );
      }
      function attach(frame: HTMLIFrameElement): void {
        frame.addEventListener(
          'load',
          () => {
            const doc = frame.contentDocument,
              win = frame.contentWindow as (Window & typeof globalThis) | null;
            if (!doc || !win || !qualifies(frame)) return;
            observedBeforeMount = !doc.querySelector('.fx-artwork');
            doc.addEventListener('securitypolicyviolation', (event) => violations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
            const image = doc.createElement('img');
            image.src = 'https://witness.invalid/image.png';
            doc.body.append(image);
            if (image.ownerDocument === doc) attempts.push('image');
            const face = new win.FontFace('BlockedProbe', 'url(https://witness.invalid/font.woff2)');
            doc.fonts.add(face);
            void face.load().catch(() => undefined);
            attempts.push('font');
          },
          { once: true },
        );
      }
      document.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
        const node = Reflect.apply(originalCreate, this, args) as HTMLElement;
        if (node instanceof HTMLIFrameElement) attach(node);
        return node;
      } as Document['createElement'];
      const api = (window as unknown as { FluxionWitness: typeof import('../packages/render/src/svg-witness.js') }).FluxionWitness;
      const made = api.createSvgPaintWitness({ document, theme, fonts: [] });
      if (!made.ok) throw Error('witness construction failed');
      try {
        const receipt = await made.value.witness(request);
        return { receipt, violations, attempts, observedBeforeMount };
      } finally {
        if (previousCreate) Object.defineProperty(document, 'createElement', previousCreate);
        else Reflect.deleteProperty(document, 'createElement');
        made.value.dispose();
      }
    },
    { theme: LIGHT_THEME, request: firstRequest },
  );
  expect(result.receipt.status).toBe('painted');
  expect(result.attempts).toEqual(['image', 'font']);
  expect(result.observedBeforeMount).toBe(true);
  for (const [directive, resource] of [
    ['img-src', 'image.png'],
    ['font-src', 'font.woff2'],
  ]) {
    await expect
      .poll(() =>
        [...result.violations, ...policyMessages].some(
          (message) => message.includes(directive ?? '') && message.includes(`https://witness.invalid/${resource}`),
        ),
      )
      .toBe(true);
  }
  await expect.poll(() => failures.map((f) => f.url).sort()).toEqual(network.sort());
  expect(failures.every((f) => /csp|content security policy/i.test(f.reason))).toBe(true);
  expect(responses).toEqual([]);
  expect(blocked).toEqual([]);
});
test('NFR-SEC-001: host CSP denying data images refuses the actual public witness without fallback @desktop', async ({ page, blocked }) => {
  await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="img-src \'none\'"><body></body>');
  await page.addScriptTag({ content: bundle });
  const receipt = await page.evaluate(
    async ({ theme, request }) => {
      const api = (window as unknown as { FluxionWitness: typeof import('../packages/render/src/svg-witness.js') }).FluxionWitness;
      const made = api.createSvgPaintWitness({ document, theme, fonts: [] });
      if (!made.ok) throw Error('unexpected construction failure');
      try {
        return await made.value.witness(request);
      } finally {
        made.value.dispose();
      }
    },
    { theme: LIGHT_THEME, request: firstRequest },
  );
  expect(receipt).toEqual({ identity: firstRequest.identity, status: 'unsupported', fontHashes: [] });
  expect(await page.locator('[data-fluxion-svg-witness]').count()).toBe(0);
  expect(blocked).toEqual([]);
});
