import { createSvgPaintRequest } from '@fluxion/format';
import type { SvgArtwork } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { expect, it } from 'vitest';
import { createSvgPaintWitness } from './svg-witness.js';

function rectangle(opacity = '1') {
  const artwork: SvgArtwork = {
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    root: {
      name: 'svg',
      attributes: { viewBox: '0 0 100 100' },
      children: [{ name: 'rect', attributes: { x: '10', y: '10', width: '80', height: '80', fill: 'red', opacity }, children: [] }],
    },
  };
  const request = createSvgPaintRequest(artwork, []);
  if (!request.ok) throw Error('invalid test artwork');
  return request.value;
}
it('FR-LIB-004: real isolated ArtworkView produces paint and no-paint receipts, then releases its frame', async () => {
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [] });
  expect(made.ok).toBe(true);
  if (!made.ok) return;
  expect(document.querySelector('[data-fluxion-svg-witness]')).toBeNull();
  try {
    const visible = rectangle();
    expect(await made.value.witness(visible)).toEqual({ identity: visible.identity, status: 'painted', fontHashes: [] });
    expect((await made.value.witness(rectangle('0'))).status).toBe('no-witness');
    expect(document.querySelector('[data-fluxion-svg-witness]')).toBeNull();
  } finally {
    made.value.dispose();
  }
});
it('NFR-SEC-001: already-aborted construction and invalid context never allocate a frame', () => {
  const abort = new AbortController();
  abort.abort();
  expect(createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [], signal: abort.signal }).ok).toBe(false);
  expect(createSvgPaintWitness({ document, theme: { ...LIGHT_THEME, name: 'x'.repeat(262145) }, fonts: [] }).ok).toBe(false);
  expect(document.querySelector('[data-fluxion-svg-witness]')).toBeNull();
});
it('FR-LIB-004: loads owned exact pinned bytes and refuses missing or changed font bytes', async () => {
  const samples = JSON.parse(
    Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
  );
  const request = samples[3].request;
  const fontUrl = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!fontUrl) throw Error('missing local font fixture');
  const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const font = { ...request.fonts[0], profile: 'inter-latin-400-ascii' as const, bytes };
  const bad = { ...font, bytes: new Uint8Array(bytes) };
  bad.bytes[0] = 0;
  expect(createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [bad] }).ok).toBe(false);
  const missing = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [] });
  if (!missing.ok) throw Error('invalid missing font session');
  try {
    expect((await missing.value.witness(request)).status).toBe('unsupported');
  } finally {
    missing.value.dispose();
  }
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [font] });
  if (!made.ok) throw Error('valid font session refused');
  bytes.fill(0);
  try {
    expect(await made.value.witness(request)).toEqual({ identity: request.identity, status: 'painted', fontHashes: [font.sha256] });
  } finally {
    made.value.dispose();
  }
  expect(document.querySelector('[data-fluxion-svg-witness]')).toBeNull();
});
it('NFR-SEC-001: stale requests, unresolved token context and unsupported text cannot return positive paint', async () => {
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [] });
  if (!made.ok) throw Error('invalid session');
  try {
    const request = rectangle();
    expect((await made.value.witness({ ...request, width: 1 })).status).toBe('unsupported');
    const missing = createSvgPaintRequest({ ...request.artwork, colors: { red: '{color.missing}' } }, []);
    if (!missing.ok) throw Error('invalid mapped artwork');
    expect((await made.value.witness(missing.value)).status).toBe('unsupported');
    expect((await made.value.witness(request)).status).toBe('painted');
  } finally {
    made.value.dispose();
  }
});
it('FR-LIB-004: clipped artwork is not confused with visible content and consecutive requests stay isolated', async () => {
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [] });
  if (!made.ok) throw Error('invalid session');
  try {
    const request = rectangle();
    const clipped = createSvgPaintRequest(
      {
        ...request.artwork,
        root: { ...request.artwork.root, children: [{ name: 'rect', attributes: { x: '110', width: '20', height: '20', fill: 'red' }, children: [] }] },
      },
      [],
    );
    if (!clipped.ok) throw Error('invalid clipped artwork');
    expect((await made.value.witness(clipped.value)).status).toBe('no-witness');
    expect((await made.value.witness(request)).status).toBe('painted');
    expect((await made.value.witness(rectangle('0'))).status).toBe('no-witness');
  } finally {
    made.value.dispose();
  }
});
it('FR-LIB-004: snapshots inherited text size and spacing from the host before lazy initialization', async () => {
  const samples = JSON.parse(
    Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
  );
  const original = samples[3].request;
  const label = original.artwork.root.children.find((node: { name: string }) => node.name === 'text');
  delete label.attributes['font-size'];
  const request = createSvgPaintRequest(original.artwork, original.fonts);
  if (!request.ok) throw Error('invalid text request');
  const fontUrl = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!fontUrl) throw Error('missing font');
  const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const previous = document.body.style.cssText;
  document.body.style.fontSize = '31px';
  document.body.style.letterSpacing = '2px';
  const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [{ ...original.fonts[0], bytes, profile: 'inter-latin-400-ascii' }] });
  document.body.style.cssText = previous;
  if (!made.ok) throw Error('invalid text session');
  let measured: string[] | undefined;
  const observers: MutationObserver[] = [];
  const originalCreate = document.createElement;
  const previousCreate = Object.getOwnPropertyDescriptor(document, 'createElement');
  let observedBeforeMount = false;
  function attach(frame: HTMLIFrameElement): void {
    frame.addEventListener(
      'load',
      () => {
        const child = frame.contentDocument;
        if (!child || !frame.isConnected || !frame.hasAttribute('data-fluxion-svg-witness')) return;
        observedBeforeMount = !child.querySelector('.fx-artwork');
        const capture = () => {
          const text = child.querySelector('text');
          if (!text) return;
          const style = frame.contentWindow?.getComputedStyle(text);
          measured = [style?.fontSize ?? '', style?.letterSpacing ?? ''];
        };
        const mounted = new MutationObserver(capture);
        observers.push(mounted);
        mounted.observe(child.body, { childList: true, subtree: true });
        capture();
      },
      { once: true },
    );
  }
  document.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    const node = Reflect.apply(originalCreate, this, args) as HTMLElement;
    if (node instanceof HTMLIFrameElement) attach(node);
    return node;
  } as Document['createElement'];
  try {
    expect((await made.value.witness(request.value)).status).toBe('painted');
    expect(observedBeforeMount).toBe(true);
    expect(measured).toEqual(['31px', '2px']);
  } finally {
    if (previousCreate) Object.defineProperty(document, 'createElement', previousCreate);
    else Reflect.deleteProperty(document, 'createElement');
    for (const observer of observers) observer.disconnect();
    made.value.dispose();
    document.body.style.cssText = previous;
  }
});
it('NFR-SEC-001: CSS-list or escaped font aliases cannot attest fallback text as the pinned face', async () => {
  const samples = JSON.parse(
    Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
  );
  const fontUrl = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!fontUrl) throw Error('missing font');
  const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  for (const family of ['Alias, Other', 'Alias;Other', 'Alias\\Other', 'Alias"Other', 'serif', 'system-ui']) {
    const original = JSON.parse(JSON.stringify(samples[3].request));
    const label = original.artwork.root.children.find((node: { name: string }) => node.name === 'text');
    label.attributes['font-family'] = family;
    original.artwork.root.children = [label];
    const font = { ...original.fonts[0], family, bytes, profile: 'inter-latin-400-ascii' as const };
    const request = createSvgPaintRequest(original.artwork, [{ family, weight: font.weight, style: font.style, sha256: font.sha256 }]);
    expect(request.ok, family).toBe(family !== 'Alias\\Other');
    if (!request.ok) continue;
    const made = createSvgPaintWitness({ document, theme: LIGHT_THEME, fonts: [font] });
    if (!made.ok) continue;
    try {
      expect((await made.value.witness(request.value)).status, family).toBe('unsupported');
    } finally {
      made.value.dispose();
    }
  }
});
