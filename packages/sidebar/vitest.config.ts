import { defineConfig } from 'vitest/config'

// The package's own test lane: the repository's root Vitest config runs this
// spec with the rest of the suite, and this config is what makes `npm test`
// inside the package work on its own.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'jsdom',
  },
})
