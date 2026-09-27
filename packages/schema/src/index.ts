// biome-ignore-all assist/source/organizeImports: version.js must stay the first export — the bundled index.d.ts opens with the first import's region, and API Extractor needs the @packageDocumentation comment (in version.ts) at the top (M2.4 review F2)
export { VERSION } from './version.js';

export { compareKeys, type IndexKey, isIndexKey, keyBetween, nKeysBetween } from './fractional-index.js';
export { createId, ID_ALPHABET, ID_LENGTH, isGeneratedId, isRecordId, type Random, type RecordId, seededRandom } from './ids.js';
export { type Err, err, type FluxError, type FluxErrorCode, type Ok, ok, type Result } from './result.js';
