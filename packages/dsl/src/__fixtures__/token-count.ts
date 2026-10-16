// The one place the token budgets name their instrument (ADR-0037): gpt-tokenizer's o200k_base, a dev dependency used by tests and
// the docs build only. A count is a regression guard and a comparison between two texts, never a prediction of a request's cost.
import { countTokens as count } from 'gpt-tokenizer/encoding/o200k_base';

/** The number of o200k_base tokens in `text`. */
export function countTokens(text: string): number {
  return count(text);
}
