// The overlay's marks for what is selected beyond its frame (FR-SHP-003, FR-CON-007): the parametric handles of
// the one selected shape, the outline along the route of a selected or hovered connector (screen-space, constant
// width, M6 cp2 F5), and the handles of the one selected connector's ends and middles.
import type { Store } from '@fluxion/core';
import { pathData, useValue } from '@fluxion/render';
import { type RouteContext, routeConnector } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { pageToScreen } from './camera.js';
import { type ConnectorHandle, connectorHandlesOf } from './connector-handles.js';
import { HANDLE_PX } from './overlay-geometry.js';
import { type PlacedParamHandle, paramHandlesOf, type ShapeDefs } from './param-handles.js';
import type { Session } from './session.js';

/** Props of {@link HandleMarks}. */
export type HandleMarksProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection, hover and camera it draws. */
  readonly session: Session;
  /** Where shape definitions are looked up. */
  readonly shapeDefs?: ShapeDefs | undefined;
  /** What routes connectors. */
  readonly routes?: RouteContext | undefined;
};

/** A connector's route as outline path data (page units), and whether it is selected. */
type Outlined = { readonly id: RecordId; readonly d: string; readonly selected: boolean };

/** The routes of the selected and hovered connectors. */
function outlines(
  view: Parameters<Parameters<Store['query']>[0]>[0],
  routes: RouteContext,
  selection: readonly RecordId[],
  hover: RecordId | undefined,
): readonly Outlined[] {
  const ids = [...new Set([...selection, ...(hover === undefined ? [] : [hover])])];
  return ids.flatMap((id) => {
    const route = (view.get(id) as { readonly kind?: unknown } | undefined)?.kind === 'connector' ? routeConnector(view, routes, id) : undefined;
    return route === undefined ? [] : [{ id, d: pathData(route.commands), selected: selection.includes(id) }];
  });
}

/** The class each kind of connector handle is drawn with. */
const HANDLE_CLASS = {
  end: 'fx-chrome-connector-end',
  way: 'fx-chrome-connector-way',
  mid: 'fx-chrome-connector-mid',
  seg: 'fx-chrome-connector-seg',
} as const;

/** The parametric handles of the one selected shape. */
function ParamMarks(props: HandleMarksProps): ReactNode {
  const { store, session, shapeDefs } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  const params = useValue(
    useMemo(
      () =>
        store.query((view): readonly PlacedParamHandle[] =>
          selection.length === 1 && shapeDefs !== undefined ? paramHandlesOf(view, shapeDefs, selection[0] as RecordId) : [],
        ),
      [store, selection, shapeDefs],
    ),
  );
  const half = HANDLE_PX / 2;
  return params.map((h) => {
    const at = pageToScreen(camera, h.page);
    return (
      <rect
        key={h.index}
        className="fx-chrome-param"
        data-param-handle={h.param}
        x={at.x - half}
        y={at.y - half}
        width={HANDLE_PX}
        height={HANDLE_PX}
        transform={`rotate(45 ${at.x} ${at.y})`}
      />
    );
  });
}

/** The outline along the routes of the selected and hovered connectors, in page units under the camera's transform, so its width stays constant on screen. */
function RouteMarks(props: HandleMarksProps): ReactNode {
  const { store, session, routes } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  const hover = useValue(session.hover.get);
  const routed = useValue(
    useMemo(
      () => store.query((view): readonly Outlined[] => (routes === undefined ? [] : outlines(view, routes, selection, hover))),
      [store, selection, hover, routes],
    ),
  );
  const origin = pageToScreen(camera, { x: 0, y: 0 });
  // nothing to outline: nothing in the overlay either
  if (routed.length === 0) return null;
  return (
    <g transform={`translate(${origin.x} ${origin.y}) scale(${camera.z})`}>
      {routed.map((r) => (
        <path
          key={r.id}
          className={r.selected ? 'fx-chrome-route fx-chrome-route-selected' : 'fx-chrome-route'}
          data-route={r.id}
          d={r.d}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/** The handles of the one selected connector: its ends and the middles of its stretches. */
function ConnectorMarks(props: HandleMarksProps): ReactNode {
  const { store, session, routes } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  const ends = useValue(
    useMemo(
      () =>
        store.query((view): readonly ConnectorHandle[] =>
          selection.length === 1 && routes !== undefined ? connectorHandlesOf(view, (id) => routeConnector(view, routes, id), selection[0] as RecordId) : [],
        ),
      [store, selection, routes],
    ),
  );
  const half = HANDLE_PX / 2;
  return ends.map((h) => {
    const at = pageToScreen(camera, h.page);
    return (
      <circle
        key={`${h.role}-${h.at}`}
        className={HANDLE_CLASS[h.role]}
        data-connector-handle={h.role === 'end' ? h.at : `${h.role}-${h.at}`}
        cx={at.x}
        cy={at.y}
        r={h.role === 'end' ? half + 1 : half - 1}
      />
    );
  });
}

/** The parametric handles of the one selected shape, the outline of selected and hovered connectors, and the handles of the one selected connector. */
export function HandleMarks(props: HandleMarksProps): ReactNode {
  return (
    <>
      <RouteMarks {...props} />
      <ConnectorMarks {...props} />
      <ParamMarks {...props} />
    </>
  );
}
