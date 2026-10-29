// FR-LIB-004: `svgWitnessStarter` starts a new renderer paint witness session per call, each disposed as a clean close (M18.17).
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { svgWitnessStarter } from './import-svg-witness.js';

describe('svgWitnessStarter (FR-LIB-004)', () => {
  it('FR-LIB-004: each call is its own session, and dispose is a clean close however often it is called', async () => {
    const start = svgWitnessStarter({ document, theme: LIGHT_THEME, fonts: [] });
    const [a, b] = [await start(), await start()];
    if (!a.ok || !b.ok) throw new Error('the witness did not start');
    expect(a.value.witness).not.toBe(b.value.witness);
    expect(await a.value.dispose()).toEqual({ ok: true, value: undefined });
    expect(await a.value.dispose()).toEqual({ ok: true, value: undefined });
    expect(await b.value.dispose()).toEqual({ ok: true, value: undefined });
  });

  it('FR-LIB-004: a theme the witness cannot snapshot is refused at start', async () => {
    const started = await svgWitnessStarter({ document, theme: { name: '' } as never, fonts: [] })();
    expect(started.ok).toBe(false);
  });
});
