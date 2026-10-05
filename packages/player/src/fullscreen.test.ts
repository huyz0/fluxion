import { describe, expect, it } from 'vitest';
import { type FullscreenDocument, type FullscreenTarget, fullscreenSupported, isFullscreen, toggleFullscreen } from './fullscreen.js';

const element = {} as Element;

describe('full screen (FR-PRS-001)', () => {
  it('FR-PRS-001: a toggle enters full screen through the standard API, with the browser chrome hidden, and leaves it again', async () => {
    const calls: unknown[] = [];
    const doc: FullscreenDocument = { fullscreenElement: null, exitFullscreen: () => Promise.resolve(void calls.push('exit')) };
    const target: FullscreenTarget = { requestFullscreen: (options) => Promise.resolve(void calls.push(options)) };
    expect(await toggleFullscreen(target, doc)).toBe('entered');
    expect(calls).toEqual([{ navigationUI: 'hide' }]);
    expect(await toggleFullscreen(target, { ...doc, fullscreenElement: element })).toBe('exited');
    expect(calls.at(-1)).toBe('exit');
  });

  it('FR-PRS-001: where only the WebKit-prefixed API exists it is used', async () => {
    const calls: string[] = [];
    const target: FullscreenTarget = { webkitRequestFullscreen: () => void calls.push('enter') };
    const doc: FullscreenDocument = { webkitExitFullscreen: () => void calls.push('exit') };
    expect(await toggleFullscreen(target, doc)).toBe('entered');
    expect(await toggleFullscreen(target, { ...doc, webkitFullscreenElement: element })).toBe('exited');
    expect(calls).toEqual(['enter', 'exit']);
  });

  it('FR-PRS-001: where neither exists (iPhone Safari) the toggle says so and changes nothing; a refused request is a result, not a throw', async () => {
    expect(fullscreenSupported({})).toBe(false);
    expect(await toggleFullscreen({}, {})).toBe('unsupported');
    expect(await toggleFullscreen({}, { fullscreenElement: element })).toBe('unsupported');
    const refusing: FullscreenTarget = { requestFullscreen: () => Promise.reject(new TypeError('not allowed')) };
    expect(await toggleFullscreen(refusing, {})).toBe('refused');
    expect(isFullscreen({ fullscreenElement: null, webkitFullscreenElement: null })).toBe(false);
    expect(isFullscreen({ webkitFullscreenElement: element })).toBe(true);
  });
});
