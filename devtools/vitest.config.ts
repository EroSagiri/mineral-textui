import {defineConfig} from 'vitest/config';
export default defineConfig({resolve:{alias:{vscode:new URL('./tests/vscode-mock.ts',import.meta.url).pathname}},test:{include:['tests/**/*.test.ts'],testTimeout:15000}});
