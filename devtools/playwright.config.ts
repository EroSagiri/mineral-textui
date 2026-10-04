import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const executablePath=process.env.TEXTUI_DEVTOOLS_BROWSER_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
export default defineConfig({testDir:'tests/browser',workers:1,timeout:45000,use:{viewport:{width:1440,height:1000},launchOptions:{executablePath}},outputDir:'../.artifacts/devtools-generic-browser'});
