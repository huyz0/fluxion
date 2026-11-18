// How an image fits a box on every surface (FR-SHP-012, ADR-0056 item 8): CSS object-fit as SVG preserveAspectRatio, and the tile of
// an image whose asset records no natural size.

/** How `cover`, `contain` and `fill` place an image in the box, as SVG preserveAspectRatio (CSS object-fit). */
export const ASPECT: { readonly [fit: string]: string } = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', fill: 'none' };

/** The tile size of an image whose asset records no natural size, px. */
export const TILE = 64;
