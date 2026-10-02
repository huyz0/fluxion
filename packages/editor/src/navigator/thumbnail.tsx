// A screen's thumbnail in the navigator (FR-SCR-002, M8.12): the screen drawn in `thumbnail` mode, fitted into a
// small box, and drawn only once its row has been in view (a long list costs what is on show). It stays drawn after:
// the view is reactive to the store, so a cached thumbnail is never stale.
import type { Store } from '@fluxion/core';
import { type RenderRegistries, ScreenView } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/** The box a thumbnail is fitted into, px. */
export const THUMBNAIL_BOX = { w: 160, h: 90 } as const;

/** Props of {@link Thumbnail}. */
export type ThumbnailProps = {
  readonly store: Store;
  readonly registries: RenderRegistries;
  readonly screenId: RecordId;
};

/** The thumbnail of one screen. */
export function Thumbnail(props: ThumbnailProps): ReactNode {
  const { store, registries, screenId } = props;
  const frame = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = frame.current;
    if (seen || el === null) return;
    // no observer (a test host): draw at once
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [seen]);
  return (
    <div
      ref={frame}
      className="fx-chrome-thumbnail"
      data-thumbnail={seen ? 'drawn' : 'pending'}
      aria-hidden="true"
      style={{ width: THUMBNAIL_BOX.w, height: THUMBNAIL_BOX.h }}
    >
      {seen ? <ScreenView registries={registries} store={store} screenId={screenId} mode="thumbnail" view={{ kind: 'fit', box: THUMBNAIL_BOX }} /> : null}
    </div>
  );
}
