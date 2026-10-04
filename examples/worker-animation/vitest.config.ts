import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
export default defineConfig({oxc:{jsx:{development:false}},plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.jsonc'}})],test:{include:['test/**/*.test.ts'],testTimeout:60000}});
