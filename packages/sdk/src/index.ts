// Public entry of @fluxion/sdk; the package comment is the dts banner in tsdown.config.ts.

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

export {
  type CoreRegistries,
  createCoreRegistries,
  type Disposable,
  type EnumParam,
  type EvaluatedOutline,
  evaluateOutline,
  type FaceMetrics,
  type HandleDef,
  hitTestShape,
  MARKER_SIZE,
  type MarkerDef,
  markerTrim,
  type NumberParam,
  type OutlineSpec,
  outlineDistance,
  type ParamSpec,
  type PluginId,
  type PointsParam,
  parseMarkerDef,
  projectToOutline,
  readFontMetrics,
  type ShapeDef,
  type TextRegionDef,
} from '@fluxion/core';
export {
  contrastRatio,
  createFontRegistry,
  type FontFaceDef,
  type FontRegistry,
  LIGHT_THEME,
  REQUIRED_COLOR_ROLES,
  type Theme,
  type ThemeProblem,
  validateTheme,
} from '@fluxion/theme';
export { definePack, type Pack, type PackRegistries, type PackSpec, registerShapeDef, type ThemeDef } from './pack.js';
