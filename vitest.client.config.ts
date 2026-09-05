import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react({ jsxImportSource: 'react' })],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    include: ['test/client/**/*.test.tsx'],
    setupFiles: ['./test/client/setup.ts'],
  },
})
