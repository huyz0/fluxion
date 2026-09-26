export interface Lib {
  Math: number;
}
export type Host = { Math: typeof Math };
export const area = (r: number): number => Math.PI * r;
