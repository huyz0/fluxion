// The React component over the element (FR-PRS-009, ADR-0026): `<FluxionPlayer src="deck.flux" position={n} onPosition={...} />`. A thin wrapper: the element draws,
// the component passes props down and events up. The element must be defined on the page (the standalone script of `@fluxion/player-inline`, or `defineFluxionPlayer`).
import { type CSSProperties, createElement, type ReactNode, useEffect, useRef } from 'react';
import type { PlayerPosition } from './element.js';

/**
 * Props of {@link FluxionPlayer}.
 *
 * @public
 */
export type FluxionPlayerProps = {
  /** The URL of the `.flux` file (fetched without credentials). */
  readonly src?: string;
  /** The bytes of a `.flux` file, instead of a URL; a new array opens the new file. */
  readonly bytes?: Uint8Array;
  /** The screen to show: its number among the visible screens (from 1) or its id. Changing it moves the deck. */
  readonly position?: number | string;
  /** The screen to open at (number or id), when the file is opened. */
  readonly start?: number | string;
  /** Draw the chrome (progress bar, counter, controls). */
  readonly controls?: boolean;
  /** Called after every move, and once when the file is drawn. */
  readonly onPosition?: (position: PlayerPosition) => void;
  /** Called when the file is drawn, with the number of visible screens. */
  readonly onLoad?: (screens: number) => void;
  /** Called with why a file could not be opened. */
  readonly onError?: (message: string) => void;
  /** A class for the element. */
  readonly className?: string;
  /** A style for the element (it is a block that fills the width it is given: give it a height or an aspect ratio). */
  readonly style?: CSSProperties;
};

/** The element as this component drives it. */
type PlayerElement = HTMLElement & {
  load(bytes: Uint8Array): Promise<void>;
  goTo(screen: number | string, group?: number): void;
  readonly position: PlayerPosition | undefined;
};

/** Whether the deck already shows `wanted` (a number among the visible screens, or an id). */
const shows = (at: PlayerPosition | undefined, wanted: number | string): boolean =>
  at !== undefined && (typeof wanted === 'number' ? at.index + 1 === wanted : at.screen === wanted);

/**
 * A presentation in a React tree, drawn by the `<fluxion-player>` element.
 *
 * @public
 */
export function FluxionPlayer(props: FluxionPlayerProps): ReactNode {
  const { src, bytes, position, start, controls, onPosition, onLoad, onError, className, style } = props;
  const ref = useRef<PlayerElement>(null);
  // the latest callbacks, so the listeners are made once
  const latest = useRef({ onPosition, onLoad, onError, position });
  latest.current = { onPosition, onLoad, onError, position };
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const on = (type: string, call: (detail: never) => void) => {
      const listener = (e: Event) => call((e as CustomEvent).detail as never);
      el.addEventListener(type, listener);
      return () => el.removeEventListener(type, listener);
    };
    const stops = [
      on('fluxion-position', (p: PlayerPosition | undefined) => p !== undefined && latest.current.onPosition?.(p)),
      on('fluxion-load', (d: { screens: number }) => {
        // a position asked for before the file was drawn is applied now
        const want = latest.current.position;
        if (want !== undefined && !shows(el.position, want)) el.goTo(want);
        latest.current.onLoad?.(d.screens);
      }),
      on('fluxion-error', (d: { message: string }) => latest.current.onError?.(d.message)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
  // bytes go to the element once it is defined on the page
  useEffect(() => {
    const el = ref.current;
    if (el === null || bytes === undefined) return;
    let current = true;
    void customElements.whenDefined('fluxion-player').then(() => {
      if (current) void el.load(bytes);
    });
    return () => {
      current = false;
    };
  }, [bytes]);
  // a changed position prop moves the deck, unless it is already there
  useEffect(() => {
    const el = ref.current;
    if (el === null || position === undefined) return;
    let current = true;
    void customElements.whenDefined('fluxion-player').then(() => {
      if (current && !shows(el.position, position)) el.goTo(position);
    });
    return () => {
      current = false;
    };
  }, [position]);
  return createElement('fluxion-player', {
    ref,
    ...(src === undefined ? {} : { src }),
    ...(start === undefined ? {} : { start: String(start) }),
    ...(controls === true ? { controls: '' } : {}),
    ...(className === undefined ? {} : { class: className }),
    ...(style === undefined ? {} : { style }),
  });
}
