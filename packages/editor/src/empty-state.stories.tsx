import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from './empty-state.js';

const meta: Meta<typeof EmptyState> = {
  title: 'Editor/EmptyState',
  component: EmptyState,
  parameters: { a11y: { test: 'error' } },
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = { args: { message: 'This screen is empty. Add a shape to start.' } };
