// The pure SHA-256 lives in `core` since ADR-0031 (the compiler derives stable ids from it synchronously); `format` keeps exporting it.
export { sha256Hex } from '@fluxion/core';
