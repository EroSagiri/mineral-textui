import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/*/tests/**/*.test.ts','packages/*/tests/**/*.test.tsx','tests/integration/**/*.test.ts','tests/integration/**/*.test.tsx','tests/**/*.test.ts','tests/**/*.test.tsx'], exclude:['node_modules/**','tests/worker-compat/**'], testTimeout:15000}});
