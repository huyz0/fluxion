/**
 * Repository content-license IDs (ADR-0182), excluding named optional code-pack exceptions.
 * This frozen list describes policy, not ownership or a redistribution grant.
 * @public
 */
export const shapePackContentLicenses: readonly string[] = Object.freeze([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'MPL-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'CC-BY-4.0',
]);
const allowed = new Set(shapePackContentLicenses);
const identifier = (token: string | undefined): token is string =>
  token !== undefined && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token) && !/^(and|or|with)$/i.test(token);

class ContentExpression {
  private at = 0;
  private depth = 0;
  private valid = true;
  private readonly tokens: readonly string[];
  constructor(tokens: readonly string[]) {
    this.tokens = tokens;
  }
  parse(): boolean {
    const value = this.or();
    return this.valid && this.at === this.tokens.length && value;
  }
  private is(operator: string): boolean {
    return this.tokens[this.at]?.toLowerCase() === operator;
  }
  private or(): boolean {
    let value = this.and();
    while (this.is('or')) {
      this.at++;
      const right = this.and();
      value = value || right;
    }
    return value;
  }
  private and(): boolean {
    let value = this.factor();
    while (this.is('and')) {
      this.at++;
      const right = this.factor();
      value = value && right;
    }
    return value;
  }
  private factor(): boolean {
    const token = this.tokens[this.at++];
    if (token === '(') {
      if (++this.depth > 32) {
        this.valid = false;
        return false;
      }
      const value = this.or();
      this.depth--;
      if (this.tokens[this.at++] !== ')') this.valid = false;
      return value;
    }
    if (!identifier(token)) {
      this.valid = false;
      return false;
    }
    // Match the existing gate: WITH retains the base license's policy decision.
    if (this.is('with')) {
      this.at++;
      if (!identifier(this.tokens[this.at++])) this.valid = false;
    }
    return allowed.has(token);
  }
}

/**
 * Bounded, pure content-policy adapter for explicit pack-parser calls. AND requires both
 * obligations; OR allows a permitted alternative; WITH follows the existing base-license policy.
 * Malformed input, over 4096 characters, over 256 tokens or over 32 nested groups fails closed.
 * @public
 */
export function allowsShapePackContentLicense(expression: string): boolean {
  if (typeof expression !== 'string' || expression.length > 4096) return false;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  return tokens.length <= 256 && new ContentExpression(tokens).parse();
}
