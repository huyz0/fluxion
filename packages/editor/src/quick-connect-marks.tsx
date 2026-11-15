// The overlay's quick-connect "+" handles (FR-EDT-015): one beyond the middle of each side of the hovered shape, while the select
// tool is between gestures. Drawn only: the select tool reads the pointer (quick-connect.ts).
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import { type ReactNode, useMemo } from 'react';
import { pageToScreen } from './camera.js';
import { QUICK_RADIUS_PX, quickHandles, quickSource } from './quick-connect.js';
import type { Session } from './session.js';
import { SELECT_TOOL } from './tools.js';

/** Props of {@link QuickConnectMarks}. */
export type QuickConnectMarksProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose hover, selection and camera it draws. */
  readonly session: Session;
};

/** The "+" handles of the hovered shape. */
export function QuickConnectMarks(props: QuickConnectMarksProps): ReactNode {
  const { store, session } = props;
  const camera = useValue(session.camera.get);
  const source = quickSource(useValue(session.hover.get), useValue(session.selection.get));
  const tool = useValue(session.tool.get);
  const sketch = useValue(session.sketch.get);
  const marquee = useValue(session.marquee.get);
  // not while a drag draws its line, a marquee is out, or another tool is in use
  const busy = sketch !== undefined || marquee !== undefined || tool !== SELECT_TOOL;
  const handles = useValue(useMemo(() => store.query((view) => quickHandles(view, busy ? undefined : source, camera)), [store, source, camera, busy]));
  const arm = QUICK_RADIUS_PX / 2;
  return handles.map((h) => {
    const p = pageToScreen(camera, h.at);
    return (
      <g key={h.side} className="fx-chrome-quick-connect" data-quick-connect={h.side}>
        <circle className="fx-chrome-quick-connect-dot" cx={p.x} cy={p.y} r={QUICK_RADIUS_PX - 2} />
        <path className="fx-chrome-quick-connect-plus" d={`M ${p.x - arm} ${p.y} H ${p.x + arm} M ${p.x} ${p.y - arm} V ${p.y + arm}`} />
      </g>
    );
  });
}
