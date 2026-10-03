// The font registry (FR-THM-008, ADR-0022): which families a document or a host can offer, where each face's bytes come from
// (a bundled file, a Google fetch, an upload), and under which licence. Pure: loading a face (`FontFace`) and measuring it live
// in the render and editor layers, which own the DOM.
import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { FAMILY } from './tokens.js';

/**
 * Where a font's bytes come from.
 *
 * @public
 */
export type FontSource = 'bundled' | 'google' | 'upload';

/**
 * One face of a family: a weight and a style, with the file or asset holding its bytes and its licence.
 *
 * @public
 */
export type FontFaceDef = {
  /** The family name as CSS and theme tokens name it. */
  readonly family: string;
  /** CSS weight, 1 to 1000. */
  readonly weight: number;
  /** CSS style. */
  readonly style: 'normal' | 'italic';
  /** Where the bytes come from. */
  readonly source: FontSource;
  /** A file of a bundled pack, relative to the pack (a bundled face). */
  readonly file?: string;
  /** The `asset` record holding the bytes (a Google or uploaded face). */
  readonly assetId?: string;
  /** SPDX id (or the user's own text for an upload). */
  readonly license: string;
  /** The copyright line the licence asks to travel with the bytes. */
  readonly copyright?: string;
};

/**
 * A family and its faces.
 *
 * @public
 */
export type FontFamilyInfo = {
  /** The family name. */
  readonly family: string;
  /** Where its faces come from (the source of the first registered face). */
  readonly source: FontSource;
  /** Its faces, in registration order. */
  readonly faces: readonly FontFaceDef[];
};

/**
 * The registry of font faces.
 *
 * @public
 */
export type FontRegistry = {
  /** Add faces, all or none: FONT_INVALID for a face that is not one, FONT_DUPLICATE for a family, weight and style already held. */
  register(faces: readonly FontFaceDef[]): Result<void, ThemeError>;
  /** The families, in the order they were first registered. */
  families(): readonly FontFamilyInfo[];
  /** The faces of `family` (none when it is unknown). */
  faces(family: string): readonly FontFaceDef[];
};

const faceKey = (f: FontFaceDef) => `${f.family}\u0000${f.weight}\u0000${f.style}`;

/** Why `face` is not a font face, or undefined. */
function problem(face: FontFaceDef): string | undefined {
  if (face.family === '' || !FAMILY.test(face.family)) return 'the family is empty or has control characters, "<" or ">"';
  if (!Number.isInteger(face.weight) || face.weight < 1 || face.weight > 1000) return 'the weight is not a whole number from 1 to 1000';
  if (face.style !== 'normal' && face.style !== 'italic') return 'the style is not normal or italic';
  if (face.source !== 'bundled' && face.source !== 'google' && face.source !== 'upload') return 'the source is not bundled, google or upload';
  if ((face.file === undefined) === (face.assetId === undefined)) return 'a face has a file or an asset, one of the two';
  if ((face.source === 'bundled') !== (face.file !== undefined)) return 'a bundled face has a file, a google or uploaded face an asset';
  if (face.license === '') return 'a face has a licence';
  return undefined;
}

/**
 * A new, empty registry.
 *
 * @public
 */
export function createFontRegistry(): FontRegistry {
  const held = new Map<string, FontFaceDef[]>();
  const taken = new Set<string>();
  return {
    register(faces) {
      const batch = new Set<string>();
      for (const face of faces) {
        const why = problem(face);
        if (why !== undefined) return err({ code: 'FONT_INVALID', message: `font ${face.family} ${face.weight} ${face.style}: ${why}` });
        const key = faceKey(face);
        if (taken.has(key) || batch.has(key))
          return err({ code: 'FONT_DUPLICATE', message: `font ${face.family} ${face.weight} ${face.style} is registered twice` });
        batch.add(key);
      }
      for (const face of faces) {
        taken.add(faceKey(face));
        held.set(face.family, [...(held.get(face.family) ?? []), face]);
      }
      return ok(undefined);
    },
    families: () => [...held].map(([family, list]) => ({ family, source: (list[0] as FontFaceDef).source, faces: list })),
    faces: (family) => held.get(family) ?? [],
  };
}
