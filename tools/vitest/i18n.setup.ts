// The English catalogs are active in every test (ADR-0023): components call the `t` macro on the global i18n, which throws until a locale is
// activated. Both modules load their catalog into the same instance.
import '../../packages/editor/src/i18n.ts';
import '../../packages/player/src/i18n.ts';
import '../../apps/studio/src/i18n.ts';
