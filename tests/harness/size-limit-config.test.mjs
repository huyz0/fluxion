// The bundle budgets (NFR-SIZE-001): the one-file player and the element script are held to PLAYER_CORE_GZIP, the same threshold as the player core, not to a ratchet of their own (M11.18).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import config from '../../.size-limit.js';
import { t } from '../../scripts/gates/thresholds.mjs';

const limit = `${Math.floor(t('PLAYER_CORE_GZIP') / 1000)} kB`;

describe('the size-limit entries of the player', () => {
  it('NFR-SIZE-001: the player core, the one-file player and the element script share the PLAYER_CORE_GZIP limit', () => {
    for (const name of ['player core', 'player-inline', 'fluxion-player script']) {
      const entry = config.find((e) => e.name === name);
      assert.ok(entry, name);
      assert.equal(entry.limit, limit, name);
      assert.equal(entry.gzip, true, name);
    }
  });
});
