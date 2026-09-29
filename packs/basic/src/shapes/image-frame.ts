// basic:image-frame (FR-SHP-002): a rectangle holding an image; until one is set, a mountain and a sun
// drawn as decorations mark it as a placeholder.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The image frame.
 *
 * @public
 */
export const imageFrame: ShapeDef = {
  id: 'basic:image-frame',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  decorations: [
    { path: 'M {w * 0.15} {h * 0.8} L {w * 0.4} {h * 0.45} L {w * 0.55} {h * 0.65} L {w * 0.65} {h * 0.55} L {w * 0.85} {h * 0.8} Z' },
    {
      path: 'M {w * 0.72 - min(w, h) * 0.08} {h * 0.3} A {min(w, h) * 0.08} {min(w, h) * 0.08} 0 1 1 {w * 0.72 + min(w, h) * 0.08} {h * 0.3} A {min(w, h) * 0.08} {min(w, h) * 0.08} 0 1 1 {w * 0.72 - min(w, h) * 0.08} {h * 0.3} Z',
    },
  ],
  defaultSize: { w: 160, h: 120 },
  keywords: ['image', 'picture', 'photo', 'placeholder'],
  category: 'basic',
  license: 'MIT',
};
