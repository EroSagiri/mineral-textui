import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';

const root=resolve(import.meta.dirname,'..'),directory=await mkdtemp(join(tmpdir(),'textui-devtools-consumer-'));
const cli=process.env.npm_execpath;if(!cli)throw new Error('Run via pnpm devtools:test:packed');
async function pnpm(args,cwd){
  const child=/\.(?:c?js|mjs)$/.test(cli)?spawn(process.execPath,[cli,...args],{cwd,windowsHide:true}):spawn(cli,args,{cwd,windowsHide:true});let output='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  assert.equal(await new Promise((done,reject)=>{child.on('exit',done);child.on('error',reject);}),0,output);return output;
}
for(const name of ['textui','textui-react'])await pnpm(['pack','--pack-destination',directory],join(root,'packages',name));
const packed=await pnpm(['pack','--pack-destination',directory],join(root,'devtools'));
assert(!packed.includes('worker-animation') && !packed.includes('tests/') && !packed.includes('examples/'),'Repo fixtures included in package');
const dependencies=Object.fromEntries(['textui','textui-react','textui-devtools'].map(name=>['@mineral/'+name,'file:./mineral-'+name+'-0.0.0.tgz']));
dependencies.react='19.3.0';
await writeFile(join(directory,'package.json'),JSON.stringify({name:'independent-devtools-consumer',private:true,type:'module',dependencies,pnpm:{overrides:{'@mineral/textui':dependencies['@mineral/textui'],'@mineral/textui-react':dependencies['@mineral/textui-react']}}}));
await pnpm(['install','--ignore-workspace','--ignore-scripts','--offline'],directory);
for(const name of ['textui','textui-react','textui-devtools'])assert((await realpath(join(directory,'node_modules/@mineral',name))).startsWith(directory),'Resolved a workspace link');
await writeFile(join(directory,'app.tsx'),`import {Action,Output,useTextState} from '@mineral/textui-react';export default function App(){const [count,setCount]=useTextState('count',0);return <><Action id="increment" label="Add" onTrigger={()=>setCount(count+1)}/><Output id="count" label="Count" value={count} stateKey="count"/></>;}`);
const testModule=pathToFileURL(createRequire(join(root,'devtools/package.json')).resolve('@playwright/test')).href;
const browserPath=process.env.TEXTUI_DEVTOOLS_BROWSER_PATH??['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
await writeFile(join(directory,'verify.mjs'),`import {startDevtools} from '@mineral/textui-devtools/server';
import {defineDevtools} from '@mineral/textui-devtools';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import browserTools from ${JSON.stringify(testModule)};
const {chromium,expect}=browserTools;
assert.equal(typeof defineDevtools,'function');
const server=await startDevtools({app:'app.tsx',port:0});let browser;
try{
  const config=await(await fetch(server.url+'/api/config')).json();assert.deepEqual(config.screens,[{id:'main'}]);
  let screen=(await(await fetch(server.url+'/api/runtime/screens/main')).json()).screen;assert(screen.text.includes('Add'));
  const response=await fetch(server.url+'/api/runtime/screens/main',{method:'PUT',body:JSON.stringify({text:screen.text.replace('- [ ] Add','- [x] Add'),expectedRevision:screen.revision})});assert.equal(response.status,200);
  browser=await chromium.launch({executablePath:${JSON.stringify(browserPath)}});const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(server.url);
  await expect(page.locator('#preview output')).toHaveText('Count: 1');
  await page.locator('#preview [data-preview-id="increment"]').click();await page.locator('#save').click();
  await expect(page.locator('#preview output')).toHaveText('Count: 2');
  await page.evaluate(()=>window.independentHmr='retained');
  await writeFile('app.tsx',(await readFile('app.tsx','utf8')).replace('label="Count"','label="Hot count"'));
  await expect(page.locator('#preview output')).toHaveText('Hot count: 2');
  assert.equal(await page.evaluate(()=>window.independentHmr),'retained');assert.deepEqual(errors,[]);
  console.log('Independent packed consumer: UI, text action, subscriptions, state and HMR passed.');
}finally{await browser?.close();await server.close();}`);

const child=spawn(process.execPath,['verify.mjs'],{cwd:directory,windowsHide:true,stdio:'inherit'});
assert.equal(await new Promise((done,reject)=>{child.on('exit',done);child.on('error',reject);}),0);
console.log('No workspace links, no repository fixtures:',directory);
