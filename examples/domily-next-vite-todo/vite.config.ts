import { domilyVite } from '@domily/next-vite-plugin';
import { defineConfig } from 'vite';
import { todoCapabilities } from './src/todo-service.ts';

export default defineConfig({
  plugins: [domilyVite({ capabilities: todoCapabilities })],
});
