import { defineConfig } from 'vitest/config'

// The package's own test lane: the repository's root Vitest config runs these
// specs with the rest of the suite, and this config is what makes `npm test`
// inside the package work on its own. The listener specs bind real loopback
// sockets, so the default environment stays node; the sidebar spec opts into
// jsdom with its own docblock.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
