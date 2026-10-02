// FR-LIB-001: a keyword search over 10 000 library entries; the M8 gate's bench leg holds its p99 to
// LIBRARY_SEARCH_10K_MAX_MS. The entries are synthetic (a few words of name and keywords each, over a fixed vocabulary)
// with the real cylinder among them; "database" must find it. The index is built once, as the panel keeps it.
import { seededRandom } from '@fluxion/schema';
import { describe, test } from 'vitest';
import { buildLibraryIndex, type LibraryEntry } from '../src/library/library-search.js';

const ENTRIES = 10_000;
const WORDS = [
  'arrow',
  'box',
  'card',
  'cloud',
  'diamond',
  'flow',
  'frame',
  'gear',
  'hexagon',
  'icon',
  'line',
  'node',
  'pill',
  'queue',
  'ring',
  'star',
  'table',
  'user',
  'wave',
  'zone',
];
const CATEGORIES = ['Basic', 'Flow', 'UML', 'Cloud', 'Network', 'Arrows'];

function entries(): LibraryEntry[] {
  const random = seededRandom(10_000);
  const pick = () => WORDS[Math.floor(random.next() * WORDS.length)] as string;
  const synthetic = Array.from({ length: ENTRIES - 1 }, (_, i): LibraryEntry => {
    const pack = `pack${i % 40}`;
    return {
      id: `${pack}:${pick()}-${pick()}-${i}`,
      name: `${pick()} ${pick()} ${i}`,
      pack,
      category: CATEGORIES[i % CATEGORIES.length] as string,
      keywords: [pick(), pick(), `k${i % 997}`],
    };
  });
  return [...synthetic, { id: 'basic:cylinder', name: 'Cylinder', pack: 'basic', category: 'Basic', keywords: ['cylinder', 'database', 'storage'] }];
}

describe('library search (FR-LIB-001)', () => {
  test('FR-LIB-001: library-search-10k', async ({ bench }) => {
    const list = entries();
    if (list.length !== ENTRIES) throw new Error(`the fixture has ${list.length} entries, not ${ENTRIES}`);
    const index = buildLibraryIndex(list);
    if (!index.search('database').some((e) => e.id === 'basic:cylinder')) throw new Error('"database" does not find the cylinder');
    await bench('library-search-10k', { async: false }, () => {
      index.search('database');
    }).run({ time: 2_000, warmupTime: 300 });
  });
});
