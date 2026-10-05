// The debug overlay (NFR-OBS-001): the frame rate, render counts and timings, shown over the editor while it is toggled on with Mod+Shift+D (Ctrl on Windows and Linux,
// Cmd on a Mac). Off by default and then costing nothing: no frame loop runs. The stats come from a `DebugStats` the editor feeds.
import { RenderStatsContext } from '@fluxion/render';
import { Profiler, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { type DebugSnapshot, DebugStats, fpsOf } from './debug-stats.js';

/** How many recent frames the frame rate is read from, and how often the numbers are redrawn (frames). */
const WINDOW = 60;
const REDRAW_EVERY = 20;

/** Whether `e` is the overlay's chord: Ctrl or Cmd with Shift and D, and no Alt. */
export const isOverlayChord = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd';

/** Whether the overlay is on, toggled by its chord on `target` (the chord is the overlay's: the page does not get it). */
export function useOverlayToggle(target: EventTarget): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onKey = (e: Event) => {
      if (!isOverlayChord(e as KeyboardEvent)) return;
      e.preventDefault();
      setOn((was) => !was);
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [target]);
  return on;
}

/** The frame rate and the stats while `on`, redrawn every few frames. */
function useReadout(stats: DebugStats, on: boolean): { fps: number; snapshot: DebugSnapshot } {
  const [readout, setReadout] = useState({ fps: 0, snapshot: stats.snapshot() });
  useEffect(() => {
    if (!on) return;
    const frames: number[] = [];
    let n = 0;
    let handle = 0;
    const tick = (t: number) => {
      frames.push(t);
      if (frames.length > WINDOW) frames.shift();
      if (++n % REDRAW_EVERY === 0) setReadout({ fps: fpsOf(frames), snapshot: stats.snapshot() });
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [stats, on]);
  return readout;
}

/** Props of {@link DebugOverlay}. */
export type DebugOverlayProps = {
  /** What to show. */
  readonly stats: DebugStats;
  /** Where the toggle chord is heard (default the window). */
  readonly target?: EventTarget;
};

/** The overlay: nothing until its chord is pressed, then a small panel of numbers that does not take the pointer. */
export function DebugOverlay(props: DebugOverlayProps): ReactNode {
  const { stats, target = window } = props;
  const on = useOverlayToggle(target);
  const { fps, snapshot } = useReadout(stats, on);
  if (!on) return null;
  return (
    <aside
      role="status"
      aria-label="Debug overlay"
      data-testid="debug-overlay"
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 1000,
        padding: '6px 10px',
        font: '12px/1.4 ui-monospace, monospace',
        color: '#e6edf3',
        background: 'rgba(13, 17, 23, 0.85)',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    >
      <div>FPS {fps.toFixed(0)}</div>
      {Object.entries(snapshot.counts).map(([name, count]) => (
        <div key={name}>
          {name}: {count}
        </div>
      ))}
      {Object.entries(snapshot.timings).map(([name, t]) => (
        <div key={name}>
          {name}: {t.mean.toFixed(2)} ms mean, {t.max.toFixed(2)} ms max ({t.count})
        </div>
      ))}
    </aside>
  );
}

/**
 * Counts the renders of `children` (the edit body) and gives the views below a recorder for the time their work takes (a connector route); the debug overlay,
 * toggled on over them, shows both (NFR-OBS-001).
 */
export function Measured(props: { readonly children: ReactNode }): ReactNode {
  const stats = useMemo(() => new DebugStats(), []);
  const record = useCallback((name: string, ms: number) => stats.time(name, ms), [stats]);
  const count = useCallback(() => stats.count('renders: edit body'), [stats]);
  return (
    <RenderStatsContext.Provider value={record}>
      <Profiler id="edit-body" onRender={count}>
        {props.children}
      </Profiler>
      <DebugOverlay stats={stats} />
    </RenderStatsContext.Provider>
  );
}
