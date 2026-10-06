import type { StorybookConfig } from '@storybook/react-vite';
import { i18nCatalogs } from '../../../tools/vite-lingui/catalogs.mjs';
import { lingui } from '../../../tools/vite-lingui/index.mjs';

// Storybook for the editor's components (M1.17). Stories are also browser tests through portable
// stories in the root Vitest browser project (ADR-0139).
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: (config) => ({ ...config, plugins: [...(config.plugins ?? []), lingui({ catalogs: i18nCatalogs })] }),
};
export default config;
