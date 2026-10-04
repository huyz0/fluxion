// Base64 for the `.flux.html` payload (RFC 4648, standard alphabet, padded). `btoa` and `atob` are not in this package's `lib`, and a
// 20 MB archive would need chunking anyway.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The base64 text of `bytes`. */
export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    parts.push(
      (ALPHABET[(n >> 18) & 63] as string) +
        (ALPHABET[(n >> 12) & 63] as string) +
        (left > 1 ? (ALPHABET[(n >> 6) & 63] as string) : '=') +
        (left > 2 ? (ALPHABET[n & 63] as string) : '='),
    );
  }
  return parts.join('');
}

/** The bytes of the base64 `text` (whitespace is ignored); undefined when it is not valid base64. */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const n = [...chunk].reduce((acc, ch) => (acc << 6) | (ch === '=' ? 0 : ALPHABET.indexOf(ch)), 0);
    out.push((n >> 16) & 255);
    if (chunk[2] !== '=') out.push((n >> 8) & 255);
    if (chunk[3] !== '=') out.push(n & 255);
  }
  return Uint8Array.from(out);
}
