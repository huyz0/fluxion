import { createCore, type ShapePackCredit, type ShapePackSubset } from '@fluxion/core';
import type { QualifiedName } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeckChrome } from './deck-chrome.js';
import { creditedPacks, isWebLink, PackCreditsList } from './pack-credits.js';
import { PlayerDeck } from './player-deck.js';
import { renderRegistriesFor } from './registries.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const upstream: ShapePackCredit = {
  id: 'lucide',
  license: 'ISC',
  attribution: 'Lucide Icons and Contributors',
  notice: 'ISC License\n\nCopyright (c) Lucide <b>bold</b>',
  source: { kind: 'upstream', reference: 'https://lucide.dev', sha256: 'a'.repeat(64), revision: 'v1', modifications: 'scaled' },
};
const scoped: ShapePackCredit = {
  id: 'feather',
  license: 'MIT',
  attribution: 'Cole Bemis (Feather)',
  notice: 'The MIT License',
  source: { kind: 'upstream', reference: 'javascript:alert(1)', sha256: 'b'.repeat(64) },
  definitionIds: ['lucide:database', 'lucide:server'] as QualifiedName[],
};
const original: ShapePackCredit = {
  id: 'fluxion',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  notice: 'MIT License',
  source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
};
const subset = (id: string, credits: readonly ShapePackCredit[]): ShapePackSubset => ({
  format: 'fluxion-shape-pack',
  formatVersion: '1.0',
  id,
  version: '1.2.0',
  license: credits.map((c) => c.license).join(' AND '),
  attribution: `${id} attribution`,
  definitions: [],
  credits,
});

describe('the credits of the shape packs a document uses (NFR-LIC-003, ADR-0050)', () => {
  it('NFR-LIC-003: saved subsets become one credited pack each, ordered by id, named only when the host knows the name', () => {
    const packs = creditedPacks([subset('lucide', [upstream, scoped]), subset('devices', [original])], new Map([['lucide', 'Lucide icons']]));
    expect(packs.map((p) => [p.id, p.name, p.version, p.license, p.credits.length])).toEqual([
      ['devices', undefined, '1.2.0', 'MIT', 1],
      ['lucide', 'Lucide icons', '1.2.0', 'ISC AND MIT', 2],
    ]);
    expect('name' in (packs[0] as object)).toBe(false);
    expect(creditedPacks([])).toEqual([]);
  });

  it("NFR-LIC-003: a 1.1 subset's font credits are listed with their notices after the shape credits, and a 1.0 subset has none", async () => {
    const font = {
      id: 'inter',
      license: 'OFL-1.1',
      attribution: 'The Inter Project Authors',
      notice: 'SIL OPEN FONT LICENSE Version 1.1',
      source: { kind: 'upstream', reference: 'https://github.com/rsms/inter', sha256: 'c'.repeat(64) },
      resourceIds: ['inter-400'],
      definitionIds: ['lucide:database'] as QualifiedName[],
    } as const;
    const v11 = { ...subset('lucide', [upstream]), formatVersion: '1.1', fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [font] } as const;
    const packs = creditedPacks([v11, subset('devices', [original])]);
    expect(packs.map((p) => p.fontCredits)).toEqual([undefined, [font]]);
    expect('fontCredits' in (packs[0] as object)).toBe(false);
    await act(async () => root.render(<PackCreditsList packs={packs} />));
    const items = [...host.querySelectorAll('[part="font-credit"]')];
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Font: The Inter Project Authors. Licence: OFL-1.1. Applies to 1 shape');
    expect(items[0]?.querySelector('[part="credit-notice"]')?.textContent).toBe('SIL OPEN FONT LICENSE Version 1.1');
    // after the pack's shape credit
    const lucide = host.querySelector('section[aria-label="lucide"]') as HTMLElement;
    expect([...lucide.querySelectorAll('li')].map((li) => li.getAttribute('part'))).toEqual(['credit', 'font-credit']);
  });

  it('NFR-LIC-003: only an absolute http(s) URL is a link', () => {
    for (const ok of ['https://lucide.dev', 'http://example.com/a']) expect(isWebLink(ok)).toBe(true);
    for (const no of ['javascript:alert(1)', 'iconify:lucide', 'data:text/html,x', '//example.com', 'lucide.dev', '']) expect(isWebLink(no)).toBe(false);
  });

  it('NFR-LIC-003: the list shows every pack, credit, licence, source and notice as text, and links only an http(s) source', async () => {
    const packs = creditedPacks([subset('lucide', [upstream, scoped]), subset('devices', [original])], new Map([['lucide', 'Lucide icons']]));
    await act(async () => root.render(<PackCreditsList packs={packs} />));
    const sections = [...host.querySelectorAll('section')];
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['devices', 'Lucide icons']);
    const text = host.textContent ?? '';
    for (const part of [
      'Lucide icons 1.2.0',
      'lucide attribution. Licence: ISC AND MIT',
      'Lucide Icons and Contributors. Licence: ISC',
      'Source: https://lucide.dev (Revision v1). Modifications: scaled',
      'Cole Bemis (Feather). Licence: MIT. Applies to 2 shapes',
      'Source: javascript:alert(1)',
      'Source: Fluxion contributors. Original artwork.',
    ])
      expect(text).toContain(part);
    // the notice is kept verbatim, its markup as text
    const notices = [...host.querySelectorAll('[part="credit-notice"]')].map((n) => n.textContent);
    expect(notices).toContain('ISC License\n\nCopyright (c) Lucide <b>bold</b>');
    expect(host.querySelector('b')).toBeNull();
    const links = [...host.querySelectorAll('a')];
    expect(links.map((a) => [a.getAttribute('href'), a.getAttribute('rel'), a.getAttribute('target')])).toEqual([
      ['https://lucide.dev', 'noopener noreferrer', '_blank'],
    ]);
    await act(async () => root.render(<PackCreditsList packs={packs} labels={{ license: 'Lizenz', appliesTo: (n) => `${n} Formen` }} />));
    expect(host.textContent).toContain('Cole Bemis (Feather). Lizenz: MIT. 2 Formen');
  });

  it('NFR-LIC-003: the deck chrome offers the credits only when there are some, and the panel opens, closes with Escape and returns the focus', async () => {
    const b = documentBuilder({ seed: 5 });
    b.screen({ size: { w: 1600, h: 900 } });
    const core = createCore(b.build());
    const registries = renderRegistriesFor(core.registries);
    const b2 = documentBuilder({ seed: 6 });
    b2.screen({ size: { w: 1600, h: 900 } });
    b2.screen({ size: { w: 1600, h: 900 } });
    const two = createCore(b2.build());
    await act(async () => root.render(<PlayerDeck store={core.store} registries={registries} chrome credits={[]} />));
    await act(frame);
    expect(host.querySelector('[part="credits"]')).toBeNull();
    const credits = creditedPacks([subset('lucide', [upstream])], new Map([['lucide', 'Lucide icons']]));
    await act(async () => root.render(<PlayerDeck store={core.store} registries={registries} chrome credits={credits} labels={{ credits: 'Mentions' }} />));
    await act(frame);
    const button = host.querySelector<HTMLButtonElement>('[part="credits"]') as HTMLButtonElement;
    expect([button.getAttribute('aria-label'), button.getAttribute('aria-expanded')]).toEqual(['Mentions', 'false']);
    await act(async () => button.click());
    const panel = host.querySelector<HTMLElement>('[part="credits-panel"]') as HTMLElement;
    expect([panel.getAttribute('role'), panel.getAttribute('aria-label'), button.getAttribute('aria-expanded')]).toEqual(['dialog', 'Mentions', 'true']);
    expect(panel.textContent).toContain('Lucide Icons and Contributors');
    expect(document.activeElement?.getAttribute('part')).toBe('credits-close');
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[part="credits-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    // with the panel open, the navigation keys are the panel's (they scroll it), not the deck's
    const counter = () => host.querySelector('[part="counter"]')?.textContent;
    await act(async () => root.render(<PlayerDeck store={two.store} registries={renderRegistriesFor(two.registries)} chrome credits={credits} />));
    await act(frame);
    await act(async () => host.querySelector<HTMLElement>('[part="credits"]')?.click());
    const open = host.querySelector<HTMLElement>('[part="credits-panel"]') as HTMLElement;
    expect(open.tabIndex).toBe(0);
    for (const key of ['ArrowDown', 'PageDown', 'ArrowRight', ' ', 'End']) {
      await act(async () => {
        (document.activeElement ?? open).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      await act(frame);
      expect(counter()).toBe('1 / 2');
    }
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    // closed, the deck's keys work again
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    await act(frame);
    expect(counter()).toBe('2 / 2');
    // the close button closes it too, and a second click on the credits button toggles it
    await act(async () => button.click());
    await act(async () => host.querySelector<HTMLElement>('[part="credits-close"]')?.click());
    expect(host.querySelector('[part="credits-panel"]')).toBeNull();
    await act(async () => button.click());
    await act(async () => button.click());
    expect(host.querySelector('[part="credits-panel"]')).toBeNull();
  });

  it('NFR-LIC-003: the controls stay shown while the credits are read past the idle time, so Escape returns the focus to the credits button', async () => {
    const credits = creditedPacks([subset('lucide', [upstream])], new Map());
    const nothing = () => undefined;
    await act(async () =>
      root.render(
        <DeckChrome index={0} count={1} onPrevious={nothing} onNext={nothing} onOverview={nothing} onFullscreen={nothing} credits={credits} idleMs={40} />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('[part="credits"]') as HTMLButtonElement;
    await act(async () => button.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(host.querySelector('[part="controls"]')?.getAttribute('data-visible')).toBe('true');
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[part="credits-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(host.querySelector('[part="controls"]')?.getAttribute('data-visible')).toBe('true');
  });
});
