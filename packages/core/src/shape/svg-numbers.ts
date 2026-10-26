// SVG's number grammar, including sign-separated coordinates and adjacent arc flags.
const NUMBER = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/;
const SPACE = /[\t\n\r ]/;

export class SvgNumbers {
  at = 0;
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
  space(): void {
    while (SPACE.test(this.source[this.at] ?? '') && this.at < this.source.length) this.at++;
  }
  number(options: { first?: boolean; flag?: boolean } = {}): number | undefined {
    this.space();
    if (this.source[this.at] === ',') {
      if (options.first) return undefined;
      this.at++;
      this.space();
    }
    const raw = options.flag ? /^[01]/.exec(this.source.slice(this.at))?.[0] : NUMBER.exec(this.source.slice(this.at))?.[0];
    if (!raw) return undefined;
    this.at += raw.length;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
}
