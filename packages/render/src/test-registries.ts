// The render registries a host with the basic pack has, for render's own tests (see test-shapes.ts).
import { builtinRegistries } from './builtins.js';
import type { RenderRegistries } from './registries.js';
import { testShapeDefs } from './test-shapes.js';

/** The built-in views with the basic rectangle. */
export const testRegistries = (): RenderRegistries => builtinRegistries(testShapeDefs());
