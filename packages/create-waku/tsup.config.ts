import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  external: [/package\.json/],
  format: ['esm'],
  minify: !options.watch,
  clean: true,
}));
