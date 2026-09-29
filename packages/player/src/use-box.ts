// The size of an element as it lays out, for fitting a screen into it; 0 x 0 until it has one.
import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * A box size in CSS pixels.
 *
 * @public
 */
export type Box = {
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/**
 * The content-box size of `ref`'s element, kept current with a ResizeObserver.
 *
 * @public
 */
export function useElementBox(ref: RefObject<HTMLElement | null>): Box {
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = () => setBox((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}
