import { generateMessageId } from '@lingui/message-utils/generateMessageId';
import { describe, expect, it } from 'vitest';
import { i18n } from './i18n.js';

// the six chrome strings of the player, with the values their placeholders take here
const EXPECTED: ReadonlyArray<readonly [message: string, shown: string]> = [
  ['Presentation', 'Presentation'],
  ['Screen overview', 'Screen overview'],
  ['Screen {n}', 'Screen 2'],
  ['Screen {n}: {name}', 'Screen 2: Intro'],
  ['Screen {n} of {count}', 'Screen 2 of 5'],
  ['Screen {n} of {count}: {name}', 'Screen 2 of 5: Intro'],
];

describe('the player chrome strings are messages (NFR-I18N-001, ADR-0023)', () => {
  it('NFR-I18N-001: the player renders its English messages: each string is in the compiled catalog by id, with no fallback text', () => {
    expect(i18n.locale).toBe('en');
    for (const [message, shown] of EXPECTED) {
      // by id alone: the text can only come from the catalog
      expect(i18n._(generateMessageId(message, ''), { n: 2, count: 5, name: 'Intro' }), message).toBe(shown);
    }
  });
});
