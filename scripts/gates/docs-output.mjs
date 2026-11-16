// What the docs site build must emit (FR-AI-011, M19.61): checked by the ladder's `docs` step right after it builds the site, so no
// step running beside it reads apps/docs/dist while Astro rewrites it.

/** The docs build output, by repository path. */
export const LLMS = 'apps/docs/dist/llms.txt';
export const LLMS_FULL = 'apps/docs/dist/llms-full.txt';

/**
 * Why the built docs site's output falls short, or '' when it does not: llms.txt present, and llms-full.txt present and holding the
 * authoring guide. `read(path)` gives a file's text or undefined when it is missing.
 */
export function docsOutputProblem(read) {
  if (read(LLMS) === undefined) return `the docs build emitted no ${LLMS}`;
  const full = read(LLMS_FULL);
  if (full === undefined) return `the docs build emitted no ${LLMS_FULL}`;
  return full.includes('Authoring guide for AI') ? '' : `${LLMS_FULL} lacks the authoring guide ("Authoring guide for AI")`;
}
