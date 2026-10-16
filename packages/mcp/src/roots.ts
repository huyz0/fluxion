// Allowed roots (ADR-0038): a path argument must resolve, symlinks followed, to a place inside one of the roots.
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

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
    const abs = resolve(path);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      try {
        real = resolve(realpathSync(resolve(abs, '..')), abs.slice(resolve(abs, '..').length + 1));
      } catch {
        return undefined;
      }
    }
    return this.#roots.some((r) => {
      const rel = relative(r, real);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    })
      ? real
      : undefined;
  }
}
