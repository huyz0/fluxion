// The content layer's elements (04 §2.2, FR-EXT-001, FR-DOC-005): each element is a
// `.fx-el[data-el-id][data-kind]` wrapper at its box, drawn by the view registered for its kind, or
// by a labelled placeholder when none is; the record is only read, never changed. Members of a group
// or frame are stored in screen coordinates (02 §3), so their list sits in a container that undoes
// the parent's placement: nesting is kept in the DOM, the parent's box is not applied twice.
// A move changes only a box's x and y: the wrapper and the members container follow it, while the
// view is not drawn again (ADR-0028 §4, 04 §5, transform-only drags).
import type { Store } from '@fluxion/core';
import { type ElementRecord, type RecordId, type Transform, transformRotation } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { type ComponentType, type CSSProperties, memo, type NamedExoticComponent, type ReactNode, useMemo } from 'react';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { sameButPlace } from './same-but-place.js';
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

/** The props an element's own subtree is drawn from. */
type NodeProps = {
  readonly store: Store;
  readonly id: RecordId;
  readonly registries: RenderRegistries;
  readonly theme: Theme;
  /** Elements a build hides: not drawn, with their members. */
  readonly hidden?: ReadonlySet<RecordId> | undefined;
};

/** Element `id`'s record as it changes (undefined once it is gone or when it is no element). */
function useElement(store: Store, id: RecordId): ElementRecord | undefined {
  const record = useValue(useMemo(() => store.record$(id), [store, id])) as ElementRecord | undefined;
  // tzap disable next-line ConditionalExpression: ElementList passes element ids only; a guard for a record replaced by another type
  return record?.type === 'element' ? record : undefined;
}

/**
 * The container of an element's members, undoing its placement. It follows the element's record
 * itself, so a move re-renders it without drawing the element's view again.
 */
const Members = memo(function Members(props: NodeProps & { readonly screenId: RecordId }): ReactNode {
  const { store, id, screenId, registries, theme, hidden } = props;
  const element = useElement(store, id);
  return (
    <div className="fx-members" style={element === undefined ? undefined : unplacement(element)}>
      <ElementList store={store} screenId={screenId} parentId={id} registries={registries} theme={theme} hidden={hidden} />
    </div>
  );
});

/** What an element's view is drawn from, and the registry versions it reads. */
type BodyProps = ElementViewProps & {
  readonly View: ComponentType<ElementViewProps>;
  readonly versions: readonly unknown[];
};

/** The versions of the registries a view reads: when one changes, the view is drawn again. */
const sameVersions = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The element's view, drawn again only when something besides its place changes: its record (but
 * for a move), its view, the store, theme, registries or their versions, or its members.
 */
const Body = memo(
  function Body(props: BodyProps): ReactNode {
    const { View, element, store, theme, registries, children } = props;
    return (
      <View element={element} store={store} theme={theme} registries={registries}>
        {children}
      </View>
    );
  },
  (a, b) =>
    a.View === b.View &&
    a.store === b.store &&
    a.theme === b.theme &&
    a.registries === b.registries &&
    a.children === b.children &&
    sameVersions(a.versions, b.versions) &&
    sameButPlace(a.element, b.element),
);

/**
 * One element and its members; memoized, so a render above it re-renders it only when its props
 * change. A move re-renders its wrapper and members container only (ADR-0028 §4).
 */
const ElementNode = memo(function ElementNode(props: NodeProps): ReactNode {
  const { store, id, registries, theme, hidden } = props;
  const element = useElement(store, id);
  const versions = [useValue(registries.elementViews.changes$), useValue(registries.shapeDefs.changes$)];
  const screenId = element?.screenId;
  const members = useMemo(
    () => (screenId === undefined ? null : <Members store={store} id={id} screenId={screenId} registries={registries} theme={theme} hidden={hidden} />),
    // tzap disable next-line ArrayDeclaration: only a re-render reads the list, which the node tests never do (browser-tested)
    [store, id, screenId, registries, theme, hidden],
  );
  if (element === undefined) return null;
  const View = registries.elementViews.get(element.kind)?.Component ?? PlaceholderView;
  return (
    <div className="fx-el" data-el-id={id} data-kind={element.kind} style={placement(element)}>
      <Body View={View} element={element} store={store} theme={theme} registries={registries} versions={versions}>
        {members}
      </Body>
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
  /** Elements a build hides (default none): they and their members are left out. */
  readonly hidden?: ReadonlySet<RecordId> | undefined;
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
  const { store, screenId, parentId, registries, theme, hidden } = props;
  const ids = useValue(useMemo(() => store.query((view) => elementsInOrder(view, screenId, parentId)), [store, screenId, parentId]));
  return ids
    .filter((id) => hidden?.has(id) !== true)
    .map((id) => <ElementNode key={id} store={store} id={id} registries={registries} theme={theme} hidden={hidden} />);
});
