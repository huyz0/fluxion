// The person's My shapes in Studio: one library kept in this browser for every document.

import { createMyShapes, type MyShapes, type MyShapesStorage } from '@fluxion/editor';
import { isBuiltinShape } from './file-shapes.js';

/** This browser's local storage, or a map for this page when the browser refuses it (a private window, a sandbox). */
function browserStorage(): MyShapesStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // reading localStorage itself can throw where storage is blocked
  }
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

let mine: MyShapes | undefined;
/** The person's My shapes (FR-LIB-008): kept in this browser, the same for every document opened, using only the bundled shapes. */
export function myShapesOf(): MyShapes {
  mine ??= createMyShapes(browserStorage(), isBuiltinShape);
  return mine;
}
