// NFR-SEC-001 (M18.201): the pack-import e2e turns the CLI's WITNESS_CLEANUP stderr lines, and only those, into `ADVISORY ` lines,
// the prefix verify shows on a passing step and ci raises as a warning, so a slow but clean witness close reaches a green ci log.
import { expect, it } from 'vitest';
import { witnessAdvisories } from './spawn-bin.js';

it('NFR-SEC-001: WITNESS_CLEANUP lines become ADVISORY lines and every other stderr line is dropped', () => {
  const trace = 'WITNESS_CLEANUP {"decided":"exited-after-reserve","closeToExitMs":2600}';
  expect(witnessAdvisories(`warning: x\r\n${trace}\nnot WITNESS_CLEANUP\n\n`)).toEqual([`ADVISORY witness-cleanup ${trace}`]);
  expect(witnessAdvisories('')).toEqual([]);
});
