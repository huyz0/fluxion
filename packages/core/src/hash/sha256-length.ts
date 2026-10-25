/** Write the FIPS 180-4 64-bit bit length into the final eight bytes of a padded message. */
export function writeSha256Length(view: DataView, byteLength: number): void {
  view.setUint32(view.byteLength - 8, Math.floor((byteLength * 8) / 2 ** 32));
  view.setUint32(view.byteLength - 4, (byteLength * 8) >>> 0);
}
