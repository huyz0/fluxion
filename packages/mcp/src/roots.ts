// Allowed roots (ADR-0038): a path argument must resolve, symlinks followed, to a place inside one of the roots.
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

/** Whether `path` is itself a symlink, dangling or not. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The real path of `abs`, or, for one that does not exist yet, its nearest existing ancestor's real path plus the missing tail. */
function realOrPlanned(abs: string): string | undefined {
  let existing = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(existing), ...tail);
    } catch {
      if (isLink(existing)) return undefined; // a dangling symlink: writing through it would leave the roots
      const parent = dirname(existing);
      if (parent === existing) return undefined;
      tail.unshift(basename(existing));
      existing = parent;
    }
  }
}

/**
 * The folders a server may read from and write into.
 *
 * @public
 */
export class Roots {
  readonly #roots: readonly string[];

  /** `roots` are made absolute and resolved through symlinks; one that does not exist is dropped. */
  constructor(roots: readonly string[]) {
    this.#roots = roots.flatMap((r) => {
      try {
        return [realpathSync(resolve(r))];
      } catch {
        return [];
      }
    });
  }

  /**
   * The real path of `path` when it lies inside a root, else `undefined`. A file that does not exist yet is judged by its folder, so a
   * save can create it; a symlink inside a root that points outside is refused.
   */
  resolve(path: string): string | undefined {
    const real = realOrPlanned(resolve(path));
    if (real === undefined) return undefined;
    return this.#roots.some((r) => {
      const rel = relative(r, real);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    })
      ? real
      : undefined;
  }
}
