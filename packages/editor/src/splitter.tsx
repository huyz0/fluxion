// A splitter between the canvas and a panel (ADR-0029, the WAI-ARIA window splitter pattern): a
// focusable separator whose value is the panel's size, resized by pointer drag and by keyboard.
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { dragSize, type EditorLayout, PANEL_LIMITS, type PanelId, resizePanel, splitterKey } from './layout.js';

/** Props of {@link Splitter}. */
export type SplitterProps = {
  /** The panel it resizes. */
  readonly panel: PanelId;
  /** Its accessible name. */
  readonly label: string;
  /** The id of the panel's element, while it is shown. */
  readonly controls: string | undefined;
  /** The current layout. */
  readonly layout: EditorLayout;
  /** Called with each new layout. */
  readonly onLayout: (layout: EditorLayout) => void;
};

type Drag = { readonly pointerId: number; readonly x: number; readonly y: number; readonly start: number };

/**
 * The splitter of `panel`: a drag moves its edge, the arrows resize it, Home and End go to its limits,
 * Enter collapses or restores it.
 */
export function Splitter(props: SplitterProps): ReactNode {
  const { panel, layout, onLayout } = props;
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const state = layout.panels[panel];
  const size = state.collapsed ? 0 : state.size;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: size };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.pointerId !== e.pointerId) return;
    onLayout(resizePanel(layout, panel, dragSize(panel, d.start, e.clientX - d.x, e.clientY - d.y)));
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = undefined;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = splitterKey(layout, panel, e.key, e.shiftKey);
    if (next === undefined) return;
    e.preventDefault();
    onLayout(next);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter is a div with role separator (WAI-ARIA APG); <hr> cannot take focus or children
    <div
      role="separator"
      tabIndex={0}
      aria-label={props.label}
      aria-controls={props.controls}
      aria-orientation={panel === 'bottom' ? 'horizontal' : 'vertical'}
      aria-valuenow={size}
      aria-valuemin={0}
      aria-valuemax={PANEL_LIMITS[panel].max}
      className={dragging ? 'fx-chrome-splitter fx-chrome-dragging' : 'fx-chrome-splitter'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    />
  );
}
