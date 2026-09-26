export function tangled(a: number, b: number): number {
  let n = 0;
  if (a > 0) {
    if (b > 0) n++;
  }
  if (a > 1) {
    if (b > 1) n++;
  }
  if (a > 2) {
    if (b > 2) n++;
  }
  if (a > 3) {
    if (b > 3) n++;
  }
  if (a > 4) {
    if (b > 4) n++;
  }
  if (a > 5) {
    if (b > 5) n++;
  }
  if (a > 6) {
    if (b > 6) n++;
  }
  return n;
}
