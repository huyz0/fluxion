import type { ConsoleLike } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { studioLogger } from './dev-logger.js';

function recorder() {
  const written: string[] = [];
  const at = (level: string) => (text: unknown) => void written.push(`${level} ${String(text)}`);
  const target: ConsoleLike = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { written, target };
}

describe('the studio logger (NFR-OBS-001)', () => {
  it('NFR-OBS-001: the studio logger takes its level and namespaces from the address, and writes warnings by default', () => {
    const quiet = recorder();
    const a = studioLogger('', quiet.target);
    a.log('info', 'hidden');
    a.child('x').log('warn', 'shown');
    expect(quiet.written).toEqual(['warn [x] shown']);
    const asked = recorder();
    const b = studioLogger('?level=debug&log=layout:*', asked.target);
    b.child('layout').child('route').log('debug', 'in');
    b.child('render').log('debug', 'out');
    expect(asked.written).toEqual(['debug [layout:route] in']);
    // an unknown level is the default
    const odd = recorder();
    studioLogger('?level=loud', odd.target).log('info', 'hidden');
    expect(odd.written).toEqual([]);
  });
});
