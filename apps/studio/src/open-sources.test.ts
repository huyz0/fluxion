import { describe, expect, it } from 'vitest';
import { fluxionFileOf, MAX_OPEN_BYTES, nameOfUrl, pickedFromLaunch, pickedFromUrl, srcOf } from './open-sources.js';

const BASE = 'https://studio.example/';
const bodyOf = (n: number, init?: ResponseInit) => new Response(new Uint8Array(n).fill(1), init);

describe('opening from a URL, the clipboard and a launch (FR-FIL-006)', () => {
  it('FR-FIL-006: ?src= names an http(s) URL, resolved against the page, and nothing else', () => {
    expect(srcOf('?src=https://a.example/x.flux', BASE)?.href).toBe('https://a.example/x.flux');
    expect(srcOf('?src=/files/x.flux', BASE)?.href).toBe('https://studio.example/files/x.flux');
    for (const bad of ['', '?src=', '?src=javascript:alert(1)', '?src=data:text/html,x', '?src=file:///etc/passwd', '?other=1', '?src=http://[bad']) {
      expect(srcOf(bad, BASE)).toBeUndefined();
    }
  });

  it('FR-FIL-006: the file takes the name its URL ends in', () => {
    expect(nameOfUrl(new URL('https://a.example/d/My%20deck.flux?x=1'))).toBe('My deck.flux');
    expect(nameOfUrl(new URL('https://a.example/'))).toBe('shared.flux');
  });

  it('FR-FIL-006: a fetched file is its bytes under its name; a failed or oversized one is a line, never a throw', async () => {
    const ok = await pickedFromUrl(new URL('https://a.example/x.flux'), () => Promise.resolve(bodyOf(3)));
    expect(ok).toEqual({ ok: true, value: { name: 'x.flux', bytes: new Uint8Array([1, 1, 1]) } });
    const missing = await pickedFromUrl(new URL('https://a.example/x.flux'), () => Promise.resolve(new Response('', { status: 404 })));
    expect(missing).toEqual({ ok: false, error: 'x.flux could not be fetched: the server answered 404' });
    const down = await pickedFromUrl(new URL('https://a.example/x.flux'), () => Promise.reject(new Error('offline')));
    expect(down).toEqual({ ok: false, error: 'x.flux could not be fetched: offline' });
    const declared = await pickedFromUrl(new URL('https://a.example/x.flux'), () =>
      Promise.resolve(bodyOf(1, { headers: { 'content-length': String(MAX_OPEN_BYTES + 1) } })),
    );
    expect(declared.ok).toBe(false);
  });

  it('FR-FIL-006: only a pasted Fluxion file is the studio’s; any other file is the editor’s', () => {
    const f = (name: string) => new File(['x'], name);
    expect(fluxionFileOf({ files: [f('a.png'), f('b.flux')], types: ['Files'] })?.name).toBe('b.flux');
    expect(fluxionFileOf({ files: [f('c.flux.html')], types: ['Files'] })?.name).toBe('c.flux.html');
    expect(fluxionFileOf({ files: [f('a.png')], types: ['Files'] })).toBeUndefined();
    expect(fluxionFileOf(null)).toBeUndefined();
  });

  it('FR-FIL-006: a launched file keeps its handle, so a save writes over it', async () => {
    const handle = { name: 'l.flux', getFile: () => Promise.resolve(new File([new Uint8Array([7])], 'l.flux')) };
    expect(await pickedFromLaunch([handle])).toEqual({ name: 'l.flux', bytes: new Uint8Array([7]), handle });
    expect(await pickedFromLaunch([])).toBeUndefined();
  });
});
