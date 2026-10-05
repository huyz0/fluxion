// The deck's chrome (FR-PRS-006): a progress bar, a screen counter and a controls bar that hides itself after the pointer and the keys have been idle. Every part has
// a `part` name, so a page that embeds the player in a shadow root styles it with `::part()`, and a CSS variable for its colours. The counter is numerals; the
// names of the controls are for assistive technology and a page may replace them (`labels`). Nothing in it is drawn over the screen's own pixels except its bars.
import { ContentCssContext } from '@fluxion/render';
import { type MouseEvent, type ReactNode, useContext, useEffect, useInsertionEffect, useRef, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';

/**
 * How long the controls wait for a pointer move or a key before they hide.
 *
 * @public
 */
export const CHROME_IDLE_MS = 3000;

/**
 * The names of the controls and the progress bar, in the page's language.
 *
 * @public
 */
export type ChromeLabels = {
  /** The progress bar. */
  readonly progress: string;
  /** The controls bar. */
  readonly controls: string;
  /** Go to the previous screen. */
  readonly previous: string;
  /** Go to the next screen. */
  readonly next: string;
  /** Open the overview of the screens. */
  readonly overview: string;
  /** Toggle full screen. */
  readonly fullscreen: string;
};

/**
 * The names the chrome uses unless the page gives its own.
 *
 * @public
 */
export const DEFAULT_LABELS: ChromeLabels = {
  progress: 'Progress',
  controls: 'Presentation controls',
  previous: 'Previous screen',
  next: 'Next screen',
  overview: 'Overview of the screens',
  fullscreen: 'Full screen',
};

/**
 * Props of {@link DeckChrome}.
 *
 * @public
 */
export type DeckChromeProps = {
  /** The position of the screen shown among the visible screens, from 0. */
  readonly index: number;
  /** How many screens there are. */
  readonly count: number;
  /** Go to the previous screen (or build group). */
  readonly onPrevious: () => void;
  /** Go to the next screen (or build group). */
  readonly onNext: () => void;
  /** Open the overview. */
  readonly onOverview: () => void;
  /** Toggle full screen. */
  readonly onFullscreen: () => void;
  /** The names of the controls (English by default). */
  readonly labels?: Partial<ChromeLabels>;
  /** Milliseconds of idle before the controls hide (default {@link CHROME_IDLE_MS}). */
  readonly idleMs?: number;
};

/** Whether the pointer or keys were used in the last `ms`: true at the start, again on every move, press or focus, false after `ms` of none. */
function useActive(ms: number): boolean {
  const [active, setActive] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const wake = () => {
      setActive(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(false), ms);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const;
    for (const e of events) window.addEventListener(e, wake);
    return () => {
      clearTimeout(timer.current);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [ms]);
  return active;
}

/** A click handler that runs `run`; after a pointer click it lets go of the button, so the deck's keys keep working, but a key press keeps the focus (the Tab order survives). */
const act = (run: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  run();
  if (e.detail > 0) e.currentTarget.blur();
};

/** The chrome's stylesheet once in the page's head, unless the host (a shadow root) adopts it itself. */
function useChromeCss(): void {
  const inject = useContext(ContentCssContext);
  useInsertionEffect(() => {
    if (!inject || document.querySelector('style[data-fx-chrome]')) return;
    const style = document.createElement('style');
    style.dataset['fxChrome'] = '';
    style.textContent = CHROME_CSS;
    document.head.append(style);
  }, [inject]);
}

/** The progress bar: a thin line along the bottom edge that fills as the presentation goes on. */
function Progress(props: { readonly index: number; readonly count: number; readonly label: string }): ReactNode {
  const { index, count, label } = props;
  return (
    <div
      part="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, count)}
      aria-valuenow={Math.min(index + 1, Math.max(1, count))}
    >
      <div part="progress-fill" style={{ width: `${count === 0 ? 0 : ((index + 1) / count) * 100}%` }} />
    </div>
  );
}

/**
 * The chrome over the deck.
 *
 * @public
 */
export function DeckChrome(props: DeckChromeProps): ReactNode {
  const { index, count, onPrevious, onNext, onOverview, onFullscreen, idleMs = CHROME_IDLE_MS } = props;
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const active = useActive(idleMs);
  useChromeCss();
  return (
    <div part="chrome" data-testid="deck-chrome">
      <Progress index={index} count={count} label={labels.progress} />
      <div part="controls" role="toolbar" aria-label={labels.controls} data-visible={active}>
        <button type="button" part="previous" aria-label={labels.previous} onClick={act(onPrevious)}>
          {'‹'}
        </button>
        <button type="button" part="next" aria-label={labels.next} onClick={act(onNext)}>
          {'›'}
        </button>
        <button type="button" part="overview" aria-label={labels.overview} onClick={act(onOverview)}>
          {'▦'}
        </button>
        <button type="button" part="fullscreen" aria-label={labels.fullscreen} onClick={act(onFullscreen)}>
          {'⛶'}
        </button>
      </div>
      <span part="counter" data-testid="deck-counter">
        {count === 0 ? 0 : index + 1} / {count}
      </span>
    </div>
  );
}
