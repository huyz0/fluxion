// The content layer's elements (04 §2.2, FR-EXT-001, FR-DOC-005): each element is a
// `.fx-el[data-el-id][data-kind]` wrapper at its box, drawn by the view registered for its kind, or
// by a labelled placeholder when none is; the record is only read, never changed. Members of a group
// or frame are stored in screen coordinates (02 §3), so their list sits in a container that undoes
// the parent's placement: nesting is kept in the DOM, the parent's box is not applied twice.
import type { Store } from '@fluxion/core';
import { type ElementRecord, type RecordId, type Transform, transformRotation } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { type CSSProperties, memo, type NamedExoticComponent, type ReactNode, useMemo } from 'react';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { elementsInOrder } from './screen-order.js';
import { useValue } from './use-value.js';

/** The wrapper's placement: the element's box, rotated about its centre (connectors have no box). */
function placement(element: ElementRecord): CSSProperties | undefined {
  const t = (element as { readonly transform?: Transform }).transform;
  if (t === undefined) return undefined;
  const turns = [`rotate(${transformRotation(t)}deg)`, t.flipX ? 'scaleX(-1)' : '', t.flipY ? 'scaleY(-1)' : ''].filter(Boolean);
  return { left: t.x, top: t.y, width: t.w, height: t.h, transform: turns.join(' ') };
}

/**
 * The members container of a boxed parent: the inverse of {@link placement} (flips, then the opposite
 * rotation about the parent's centre, then the parent's offset), so members use screen coordinates.
 */
function unplacement(element: ElementRecord): CSSProperties | undefined {
  const t = (element as { readonly transform?: Transform }).transform;
  if (t === undefined) return undefined;
  const turns = [t.flipY ? 'scaleY(-1)' : '', t.flipX ? 'scaleX(-1)' : '', `rotate(${-transformRotation(t)}deg)`].filter(Boolean);
  return { left: -t.x, top: -t.y, transformOrigin: `${t.x + t.w / 2}px ${t.y + t.h / 2}px`, transform: turns.join(' ') };
}

/**
 * Drawn for a kind no view is registered for (or a shape whose definition is unknown): the kind is
 * shown, the record left as it is (FR-DOC-005).
 *
 * @public
 */
export function PlaceholderView(props: ElementViewProps): ReactNode {
  const label = `Unsupported element: ${props.element.kind}`;
  // members stay outside the img role, whose descendants are presentational
  return (
    <>
      <div className="fx-placeholder" role="img" aria-label={label} title={label}>
        <span className="fx-placeholder-label">{props.element.kind}</span>
      </div>
      {props.children}
    </>
  );
}

/** One element and its members; memoized, so a render above it re-renders it only when its props change. */
const ElementNode = memo(function ElementNode(props: {
  readonly store: Store;
  readonly id: RecordId;
  readonly registries: RenderRegistries;
  readonly theme: Theme;
}): ReactNode {
  const { store, id, registries, theme } = props;
  const element = useValue(useMemo(() => store.record$(id), [store, id])) as ElementRecord | undefined;
  useValue(registries.elementViews.changes$);
  useValue(registries.shapeDefs.changes$);
  if (!element || element.type !== 'element') return null;
  const View = registries.elementViews.get(element.kind)?.Component ?? PlaceholderView;
  return (
    <div className="fx-el" data-el-id={id} data-kind={element.kind} style={placement(element)}>
      <View element={element} store={store} theme={theme} registries={registries}>
        <div className="fx-members" style={unplacement(element)}>
          <ElementList store={store} screenId={element.screenId} parentId={id} registries={registries} theme={theme} />
        </div>
      </View>
    </div>
  );
});

/**
 * Props of {@link ElementList}.
 *
 * @public
 */
export type ElementListProps = {
  /** The document store. */
  readonly store: Store;
  /** The screen the elements are on. */
  readonly screenId: RecordId;
  /** The group or frame holding them; absent for the screen root. */
  readonly parentId?: RecordId;
  /** Where element views are looked up. */
  readonly registries: RenderRegistries;
  /** The theme styles resolve against. */
  readonly theme: Theme;
};

/**
 * The visible elements under `parentId` (or at the root of `screenId`), back to front. Memoized: a
 * render above it (a theme's colours changing, 04 §2.3) re-renders it only when its props change. Its
 * views resolve token refs to `var(--fx-…)`, so it draws styled only under an element carrying
 * `toCssVars(theme)`, as `<ScreenView>` does (ADR-0015 amendment, M5.13).
 *
 * @public
 */
export const ElementList: NamedExoticComponent<ElementListProps> = memo(function ElementList(props: ElementListProps): ReactNode {
  const { store, screenId, parentId, registries, theme } = props;
  const ids = useValue(useMemo(() => store.query((view) => elementsInOrder(view, screenId, parentId)), [store, screenId, parentId]));
  return ids.map((id) => <ElementNode key={id} store={store} id={id} registries={registries} theme={theme} />);
});
