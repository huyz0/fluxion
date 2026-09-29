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
  type HandleDef,
  hitTestShape,
  type NumberParam,
  type OutlineSpec,
  outlineDistance,
  type ParamSpec,
  type PluginId,
  type PointsParam,
  projectToOutline,
  type ShapeDef,
  type TextRegionDef,
} from '@fluxion/core';
export { definePack, type Pack, type PackRegistries, type PackSpec, registerShapeDef } from './pack.js';
