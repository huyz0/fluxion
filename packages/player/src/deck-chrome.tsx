// The deck's chrome (FR-PRS-006): a progress bar, a screen counter and a controls bar that hides itself after the pointer and the keys have been idle. Every part has
// a `part` name, so a page that embeds the player in a shadow root styles it with `::part()`, and a CSS variable for its colours. The counter is numerals; the
// names of the controls are for assistive technology and a page may replace them (`labels`). Nothing in it is drawn over the screen's own pixels except its bars
// and, while open, the credits of the shape packs the document uses (ADR-0050).
import { ContentCssContext } from '@fluxion/render';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useEffect, useInsertionEffect, useRef, useState } from 'react';
import { CHROME_CSS } from './chrome-css.js';
import { type CreditedPack, type CreditsLabels, PackCreditsList } from './pack-credits.js';

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
  /** Show the credits of the shape packs the document uses. */
  readonly credits: string;
  /** Close the credits. */
  readonly closeCredits: string;
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
  credits: 'Credits',
  closeCredits: 'Close credits',
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
  /** The credits of the shape packs the document uses; with none, there is no credits button. */
  readonly credits?: readonly CreditedPack[];
  /** The words of the credits list (English by default). */
  readonly creditsLabels?: Partial<CreditsLabels>;
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

/** The credits panel: the list, and a button and Escape that close it, the focus back on the credits button. */
function CreditsPanel(props: {
  readonly packs: readonly CreditedPack[];
  readonly labels: ChromeLabels;
  readonly creditsLabels: Partial<CreditsLabels> | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    props.onClose();
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region takes the focus so the keys scroll a long notice (WCAG 2.1.1); the deck leaves its keys alone
    <div part="credits-panel" role="dialog" aria-label={props.labels.credits} tabIndex={0} onKeyDown={onKeyDown}>
      <button ref={close} type="button" part="credits-close" aria-label={props.labels.closeCredits} onClick={props.onClose}>
        {'×'}
      </button>
      <PackCreditsList packs={props.packs} {...(props.creditsLabels === undefined ? {} : { labels: props.creditsLabels })} />
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
  const [creditsOpen, setCreditsOpen] = useState(false);
  const creditsButton = useRef<HTMLButtonElement>(null);
  const credits = props.credits ?? [];
  useChromeCss();
  return (
    <div part="chrome" data-testid="deck-chrome">
      <Progress index={index} count={count} label={labels.progress} />
      {/* shown while the credits panel is open, so its Escape can hand the focus back to the credits button (WCAG 2.4.3) */}
      <div part="controls" role="toolbar" aria-label={labels.controls} data-visible={active || creditsOpen}>
        <button type="button" part="previous" aria-label={labels.previous} onClick={act(onPrevious)}>
          {'‹'}
        </button>
        <button type="button" part="next" aria-label={labels.next} onClick={act(onNext)}>
          {'›'}
        </button>
        <button type="button" part="overview" aria-label={labels.overview} onClick={act(onOverview)}>
          {'▦'}
        </button>
        {credits.length === 0 ? null : (
          <button
            ref={creditsButton}
            type="button"
            part="credits"
            aria-label={labels.credits}
            aria-expanded={creditsOpen}
            onClick={() => setCreditsOpen((open) => !open)}
          >
            {'ⓘ'}
          </button>
        )}
        <button type="button" part="fullscreen" aria-label={labels.fullscreen} onClick={act(onFullscreen)}>
          {'⛶'}
        </button>
      </div>
      {creditsOpen && credits.length > 0 ? (
        <CreditsPanel
          packs={credits}
          labels={labels}
          creditsLabels={props.creditsLabels}
          onClose={() => {
            setCreditsOpen(false);
            creditsButton.current?.focus();
          }}
        />
      ) : null}
      <span part="counter" data-testid="deck-counter">
        {count === 0 ? 0 : index + 1} / {count}
      </span>
    </div>
  );
}
