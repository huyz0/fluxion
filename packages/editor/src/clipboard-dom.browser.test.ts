import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPayload } from './clipboard.js';
import { readAsync, readFromEvent, templateJson, writeAsync, writeToEvent } from './clipboard-dom.js';
import { CLIPBOARD_TYPE, MAX_PAYLOAD_CHARS, payloadHtml, payloadJson, WEB_CLIPBOARD_TYPE } from './clipboard-format.js';

function payload() {
  const b = documentBuilder({ seed: 41 });
  const s = b.screen();
  const t = b.text(s, 'a <script>alert(1)</script> & b', { x: 0, y: 0, w: 100, h: 20 });
  const core = createCore(b.build());
  const p = copyPayload(core.store, [t], { docId: 'doc', screen: s });
  if (p === undefined) throw new Error('nothing copied');
  return p;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the clipboard events and the template (FR-EDT-007)', () => {
  it('FR-EDT-007: the template is read from an inert document: its text only, and nothing in the page runs', () => {
    const p = payload();
    const json = payloadJson(p);
    (globalThis as { __ran?: boolean }).__ran = false;
    const hostile = `<img src=x onerror="globalThis.__ran=true"><script>globalThis.__ran=true</script>${payloadHtml(p, json)}<template data-fluxion="1">second</template>`;
    // the first template is the one read (the second is ignored); the markup around it is not inserted anywhere
    expect(templateJson(hostile)).toBe(json);
    expect(templateJson(payloadHtml(p, json))).toBe(json);
    expect(templateJson('<p>nothing</p>')).toBeUndefined();
    // HTML of an absurd length is not parsed at all
    expect(templateJson(`${'x'.repeat(2 * MAX_PAYLOAD_CHARS + 1)}${payloadHtml(p, json)}`)).toBeUndefined();
    expect((globalThis as { __ran?: boolean }).__ran).toBe(false);
    // the label's markup stayed text all the way: the payload parses back to the same label
    expect(JSON.stringify(JSON.parse(templateJson(payloadHtml(p, json)) as string))).toContain('<script>alert(1)</script>');
  });

  it('FR-EDT-007: a copy event carries three representations, and a paste event reads the custom type first, then the HTML template', () => {
    const p = payload();
    const out = new DataTransfer();
    const json = writeToEvent(out, p);
    expect(json).toBe(payloadJson(p));
    expect(out.getData(CLIPBOARD_TYPE)).toBe(json);
    expect(out.getData('text/html')).toContain('<template data-fluxion="1">');
    expect(out.getData('text/plain')).toContain('alert(1)');
    expect(readFromEvent(out)?.json).toBe(json);
    expect(readFromEvent(out)?.parsed.ok).toBe(true);
    // a host that dropped the custom type: the template in the HTML
    const html = new DataTransfer();
    html.setData('text/html', out.getData('text/html'));
    expect(readFromEvent(html)?.json).toBe(json);
    // nothing of Fluxion's: nothing read; something that is not a payload: read, and invalid
    expect(readFromEvent(new DataTransfer())).toBeUndefined();
    const plain = new DataTransfer();
    plain.setData('text/plain', 'just text');
    expect(readFromEvent(plain)).toBeUndefined();
    const bad = new DataTransfer();
    bad.setData(CLIPBOARD_TYPE, '{"fluxion":"other"}');
    expect(readFromEvent(bad)?.parsed.ok).toBe(false);
  });
  it('FR-EDT-007: the menu path writes every representation in one navigator.clipboard.write, and a refusal is false', async () => {
    const p = payload();
    const write = vi.fn(async (_items: ClipboardItem[]) => {});
    vi.stubGlobal('navigator', { clipboard: { write } });
    expect(await writeAsync(p)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [item] = write.mock.calls[0]?.[0] ?? [];
    expect(item?.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
    expect(await (await item?.getType('text/html'))?.text()).toContain('<template data-fluxion="1">');
    // the web custom format only where the browser takes it
    expect(item?.types.includes(WEB_CLIPBOARD_TYPE)).toBe(typeof ClipboardItem.supports === 'function' && ClipboardItem.supports(WEB_CLIPBOARD_TYPE));
    write.mockRejectedValueOnce(new Error('denied'));
    expect(await writeAsync(p)).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await writeAsync(p)).toBe(false);
  });

  it('FR-EDT-007: the menu path reads the richest representation: the web custom format, then the HTML template; a refusal reads nothing', async () => {
    const p = payload();
    const json = payloadJson(p);
    const item = (parts: Record<string, string>) => ({ types: Object.keys(parts), getType: async (type: string) => new Blob([parts[type] ?? ''], { type }) });
    const reads = (items: unknown, fail = false) => vi.fn(async (_options?: unknown) => (fail ? Promise.reject(new Error('denied')) : items));
    const stub = (read: ReturnType<typeof reads>) => vi.stubGlobal('navigator', { clipboard: { read } });
    stub(reads([item({ [WEB_CLIPBOARD_TYPE]: json, 'text/html': 'ignored' })]));
    expect((await readAsync())?.json).toBe(json);
    const read = reads([item({ 'text/html': payloadHtml(p, json) })]);
    stub(read);
    expect((await readAsync())?.parsed.ok).toBe(true);
    // the HTML is asked for unsanitised, so the template survives
    expect(read).toHaveBeenCalledWith({ unsanitized: ['text/html'] });
    // a browser that does not know the option is asked again without it
    const picky = vi.fn(async (options?: unknown) => {
      if (options !== undefined) throw new TypeError('unsupported');
      return [item({ 'text/html': payloadHtml(p, json) })];
    });
    stub(picky);
    expect((await readAsync())?.json).toBe(json);
    expect(picky).toHaveBeenCalledTimes(2);
    // nothing of Fluxion's, or a refusal: nothing
    stub(reads([item({ 'text/plain': 'x' })]));
    expect(await readAsync()).toBeUndefined();
    stub(reads([], true));
    expect(await readAsync()).toBeUndefined();
    vi.stubGlobal('navigator', {});
    expect(await readAsync()).toBeUndefined();
  });
});
