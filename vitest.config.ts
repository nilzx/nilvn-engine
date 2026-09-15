import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests live beside each package under `packages/<pkg>/test/*.test.ts` and
// import the package source directly — vitest transpiles the TypeScript with
// esbuild, so there is no build step and the tests exercise the real source.
// Default environment is `node`; a test that needs a DOM opts in per-file with a
// `// @vitest-environment jsdom` pragma.
const fromHere = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  // Resolve the workspace packages to their SOURCES: a bare `@nilvn/engine`
  // import would otherwise go through the package's `main` to dist/, a build
  // artifact CI never has (and a dev machine may have stale).
  resolve: {
    alias: {
      '@nilvn/core': fromHere('./packages/core/src/index.ts'),
      '@nilvn/engine': fromHere('./packages/engine/src/index.ts'),
      '@nilvn/plugin-sdk': fromHere('./packages/plugin-sdk/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
