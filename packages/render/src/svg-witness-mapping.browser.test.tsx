import { createCore, parseShapeDef } from '@fluxion/core';
import type { SvgPaintRequest } from '@fluxion/format';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { createSvgPaintWitness } from './svg-witness.js';
import { testRegistries } from './test-registries.js';

const samples = JSON.parse(
  Object.values(import.meta.glob('../../format/src/__fixtures__/svg-paint-requests.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as { name: string; request: SvgPaintRequest }[];
function snapshot(root: SVGSVGElement): unknown {
  const elements = [root, ...root.querySelectorAll('*')];
  const ids = new Map(elements.filter((e) => e.id).map((e, i) => [e.id, `id${i}`]));
  const value = (key: string, input: string): string => {
    if (key === 'id') return ids.get(input) ?? input;
    if (key === 'href') return `#${ids.get(input.slice(1)) ?? input.slice(1)}`;
    return input.replace(/url\(\s*(['"]?)#([\w.:-]+)\1\s*\)/g, (_match, _quote: string, id: string) => `url(#${ids.get(id) ?? id})`);
  };
  const tree = (node: Element): unknown => ({
    name: node.localName,
    namespace: node.namespaceURI,
    attributes: [...node.attributes]
      .map((attribute) => [attribute.name, value(attribute.name, attribute.value)])
      .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    children: [...node.childNodes].map((child) => (child.nodeType === 1 ? tree(child as Element) : [child.nodeType, child.textContent])),
  });
  const matrix = root.getCTM();
  return {
    tree: tree(root),
    matrix: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
    size: [root.width.baseVal.value, root.height.baseVal.value],
  };
}
function observeMounted(capture: (value: unknown) => void): () => void {
  const native = document.createElement,
    own = Object.getOwnPropertyDescriptor(document, 'createElement');
  const observers: MutationObserver[] = [];
  document.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    const element = Reflect.apply(native, this, args) as HTMLElement;
    if (element instanceof HTMLIFrameElement)
      element.addEventListener(
        'load',
        () => {
          const doc = element.contentDocument;
          if (!doc) return;
          const inspect = () => {
            const node = doc.querySelector<SVGSVGElement>('.fx-artwork');
            if (node) capture(snapshot(node));
          };
          const observer = new MutationObserver(inspect);
          observers.push(observer);
          observer.observe(doc.body, { subtree: true, childList: true });
          inspect();
        },
        { once: true },
      );
    return element;
  } as Document['createElement'];
  return () => {
    for (const observer of observers) observer.disconnect();
    if (own) Object.defineProperty(document, 'createElement', own);
    else Reflect.deleteProperty(document, 'createElement');
  };
}
it('FR-LIB-004: actual isolated mount preserves ScreenView structure and numeric viewport mapping', async () => {
  const url = Object.values(
    import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?url', import: 'default', eager: true }),
  )[0];
  if (!url) throw Error('missing local font');
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  for (const { name, request } of samples) {
    const definition = parseShapeDef({
      id: 'test:witness-mapping',
      defaultSize: { w: request.width, h: request.height },
      artwork: request.artwork,
      outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
      anchors: [],
    });
    if (!definition.ok) throw Error('invalid definition');
    const registries = testRegistries();
    registries.shapeDefs.register(definition.value.id, definition.value, 'test');
    const builder = documentBuilder({ seed: 18484 }),
      screenId = builder.screen({ size: { w: request.width, h: request.height } });
    builder.rect(screenId, { defId: definition.value.id, x: 0, y: 0, w: request.width, h: request.height });
    const core = createCore(builder.build()),
      host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const made = createSvgPaintWitness({
      document,
      theme: LIGHT_THEME,
      fonts: request.fonts.map((font) => ({ ...font, bytes, profile: 'inter-latin-400-ascii' })),
    });
    if (!made.ok) throw Error('invalid witness');
    let actual: unknown;
    const restore = observeMounted((value) => {
      actual = value;
    });
    try {
      await act(async () =>
        root.render(
          <ScreenView
            store={core.store}
            screenId={screenId}
            mode="present"
            view={{ kind: 'fit', box: { w: request.width, h: request.height } }}
            registries={registries}
            theme={LIGHT_THEME}
          />,
        ),
      );
      const reference = host.querySelector<SVGSVGElement>('.fx-artwork');
      if (!reference) throw Error('missing ScreenView artwork');
      expect((await made.value.witness(request)).status, name).toBe('painted');
      expect(actual, name).toEqual(snapshot(reference));
    } finally {
      restore();
      made.value.dispose();
      act(() => root.unmount());
      host.remove();
    }
  }
});
