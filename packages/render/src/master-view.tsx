// A screen's master layer (FR-SCR-005, ADR-0054): beneath the screen's own elements, the applied master's elements (not its
// placeholders, and none with `hideMasterElements`), then, where the mode policy draws them (edit only), a dashed hint for each
// placeholder no element of the screen fills, its name inside. Derived from the records through the store, so editing the master
// redraws every screen that uses it; drawn by the same element views in edit, present and export (ADR-0015).
import { type MasterLayers, masterLayers, type Store, sameMasterLayers } from '@fluxion/core';
import type { ElementRecord, RecordId } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { type ReactNode, useMemo } from 'react';
import { ElementList, placement } from './elements.js';
import type { RenderRegistries } from './registries.js';
import { useValue } from './use-value.js';

/**
 * What the applied master of `screenId` draws there, following the records; undefined when none applies. The value stays the same
 * object while what it draws is the same, so a drag on the screen re-renders neither the screen nor the master layer.
 *
 * @public
 */
export function useMasterLayers(store: Store, screenId: RecordId): MasterLayers | undefined {
  return useValue(
    useMemo(() => {
      let last: MasterLayers | undefined;
      return store.query((view) => {
        const next = masterLayers(view, screenId);
        if (!sameMasterLayers(last, next)) last = next;
        return last;
      });
    }, [store, screenId]),
  );
}

/** Props of {@link MasterLayer}. */
type MasterLayerProps = {
  /** The document store. */
  readonly store: Store;
  /** What the master draws, from {@link useMasterLayers}; none when no master applies. */
  readonly layers: MasterLayers | undefined;
  /** Where element views are looked up. */
  readonly registries: RenderRegistries;
  /** The theme styles resolve against. */
  readonly theme: Theme;
  /** Whether unfilled placeholders are drawn as hints (the mode policy's). */
  readonly hints: boolean;
  /** Elements a build hides on the screen: none of the master's is among them, so they are passed on as they are. */
  readonly hidden?: ReadonlySet<RecordId> | undefined;
};

/** One unfilled placeholder's hint: its box, dashed, with its name. */
function PlaceholderHint(props: { readonly store: Store; readonly id: RecordId }): ReactNode {
  const element = useValue(useMemo(() => props.store.record$(props.id), [props.store, props.id])) as (ElementRecord & { placeholder?: string }) | undefined;
  if (element === undefined) return null;
  return (
    <div className="fx-master-placeholder" data-placeholder={element.placeholder} style={placement(element)}>
      <span className="fx-master-placeholder-name">{element.placeholder}</span>
    </div>
  );
}

/** The master's elements beneath the screen's own, and its unfilled placeholders where hints are drawn. */
export function MasterLayer(props: MasterLayerProps): ReactNode {
  const { store, layers, registries, theme, hints } = props;
  // the master's placeholders never draw as its elements; a screen's build never hides one of the master's
  const placeholders = layers?.placeholders;
  const hidden = useMemo(() => new Set([...(placeholders ?? []), ...(props.hidden ?? [])]), [placeholders, props.hidden]);
  if (layers === undefined) return null;
  return (
    <div className="fx-master" data-master-id={layers.master}>
      {layers.elements ? <ElementList store={store} screenId={layers.master} registries={registries} theme={theme} hidden={hidden} /> : null}
      {hints ? layers.unfilled.map((id) => <PlaceholderHint key={id} store={store} id={id} />) : null}
    </div>
  );
}
