// Entry `@fluxion/schema/testing`: document builders and fast-check arbitraries for tests,
// fixtures and examples in every package (testing.md §3, §4). Imports fast-check at runtime, so
// fast-check is a regular dependency of @fluxion/schema; the main entry never imports this module.
export { arbDocument, arbElement, arbRectOptions } from './arbitraries.js';
export { type ConnectOptions, type DocumentBuilder, documentBuilder, plainText, type RectOptions } from './builders.js';
