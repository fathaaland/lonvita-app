import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    // Every file boots its own Payload, which pushes the schema (ALTER TABLE) against the one shared
    // database — run in parallel, those ALTERs deadlock with the other files' open transactions.
    fileParallelism: false,
  },
})
