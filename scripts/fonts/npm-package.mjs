// Fetching a package of the npm registry for the font scripts (ADR-0022): the tarball of a pinned version, checked against the
// integrity the registry publishes, read in memory. Used by vendor.mjs (the bundled fonts) and build-catalog.mjs (the Google Fonts
// catalog); no file is written and nothing is installed.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const REGISTRY = 'https://registry.npmjs.org';

/** The text of a NUL-terminated tar header field. */
const field = (header, from, to) => header.subarray(from, to).toString('utf8').replace(/\0.*$/s, '');

/** The files of a gzipped tar (ustar, with its name prefix): `{ name, data }` for each regular file. */
export function untar(gz) {
  const tar = gunzipSync(gz);
  const files = [];
  let at = 0;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const prefix = field(header, 345, 500);
    const name = prefix === '' ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`;
    const size = Number.parseInt(field(header, 124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    if (type === '0') files.push({ name, data: tar.subarray(at + 512, at + 512 + size) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * The package `name` at `version`: its files (paths as in the tarball, under `package/`), its licence field and the version.
 * Throws when the tarball does not match the integrity the registry gives for that version.
 */
export async function fetchNpmPackage(name, version) {
  const meta = await (await fetch(`${REGISTRY}/${name}/${version}`)).json();
  const response = await fetch(meta.dist.tarball);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = String(meta.dist.integrity).split('-');
  const actual = createHash(algorithm).update(bytes).digest('base64');
  if (algorithm !== 'sha512' || actual !== expected) throw new Error(`${name}@${version}: the tarball does not match the registry's integrity`);
  return { files: untar(bytes), license: meta.license, version: meta.version };
}
