import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=process.env.TEXTUI_DEVTOOLS_TEST_DIRECTORY??resolve('../../.artifacts/devtools-fixtures-'+Date.now());
process.env.TEXTUI_DEVTOOLS_TEST_DIRECTORY=directory;
const systemBrowser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
export default defineConfig({
  testDir:'tests/browser',workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5174',viewport:{width:1440,height:1000},launchOptions:{executablePath:process.env.TEXTUI_DEVTOOLS_BROWSER_PATH??systemBrowser}},
  webServer:[
    {command:'pnpm dev --no-open',url:'http://127.0.0.1:5174',reuseExistingServer:false,env:{TEXTUI_DEVTOOLS_PORT:'5174',TEXTUI_DEVTOOLS_DIRECTORY:directory,TEXTUI_DEVTOOLS_WORKER_TASK_URL:'http://127.0.0.1:8797/apps/devtools-single-screen-test',TEXTUI_DEVTOOLS_WORKER_ANIMATION_URL:'http://127.0.0.1:8798/apps/devtools-test'},timeout:60000},
    {command:'pnpm --dir ../../examples/worker-app exec wrangler dev --local --port 8797 --inspector-port 9297 --compatibility-date 2026-10-03 --persist-to ../../.artifacts/devtools-worker-single-screen',url:'http://127.0.0.1:8797/apps/devtools-single-screen-test/screen',timeout:60000},
    {command:'pnpm --dir ../../examples/worker-animation exec wrangler dev --local --port 8798 --inspector-port 9298 --compatibility-date 2026-10-03 --persist-to ../../.artifacts/devtools-worker-animation',url:'http://127.0.0.1:8798/apps/devtools-test/screens/build',timeout:60000},
  ],
  outputDir:'../.artifacts/devtools-browser-results',
});
