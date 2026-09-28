// The one place that reads the render mode (04 §2.6, ADR-0015): every mode difference is an entry of
// this policy, and scripts/gates/check-mode-policy.mjs refuses a branch on `mode` anywhere else in
// render, so edit, present and export stay the same renderer.

/**
 * What a screen is rendered for: editing, presenting, exporting (static HTML, SVG, PDF) or a thumbnail.
 *
 * @public
 */
export type RenderMode = 'edit' | 'present' | 'export' | 'thumbnail';

/**
 * Everything a mode changes about rendering (the allow-list of 04 §2.6).
 *
 * @public
 */
export type ModePolicy = {
  /** Mount the editor's overlay slot (edit only). */
  readonly editOverlay: boolean;
  /** Content receives pointer events and focus (present only; the editor captures them in edit). */
  readonly interactive: boolean;
  /** Views may measure the DOM after mounting (not in export or thumbnails: static output). */
  readonly measure: boolean;
};

const POLICIES: { readonly [M in RenderMode]: ModePolicy } = {
  edit: { editOverlay: true, interactive: false, measure: true },
  present: { editOverlay: false, interactive: true, measure: true },
  export: { editOverlay: false, interactive: false, measure: false },
  thumbnail: { editOverlay: false, interactive: false, measure: false },
};

/**
 * The policy of `mode`.
 *
 * @public
 */
export function modePolicy(mode: RenderMode): ModePolicy {
  return POLICIES[mode];
}
