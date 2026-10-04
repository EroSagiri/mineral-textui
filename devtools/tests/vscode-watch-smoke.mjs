import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),fixture=resolve(root,'.artifacts/watch-preview.ts');
await mkdir(resolve(root,'.artifacts'),{recursive:true});
await writeFile(fixture,'export default {get:()=>undefined};');
const child=spawn(process.execPath,['vscode/build.mjs','--watch'],{cwd:root,windowsHide:true,env:{...process.env,TEXTUI_DEVTOOLS_PREVIEW:fixture},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const until=async predicate=>{
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('Watch timeout: '+output);
};
const marker=()=>readFile(resolve(root,'vscode/dist/reload.json'),'utf8');
try{
  await until(()=>output.includes('[textui-watch] ready'));
  await new Promise(resolve=>setTimeout(resolve,800));
  const before=await marker();
  await writeFile(fixture,'export default {get:()=>undefined,marker:"watch-updated"};');
  await until(async()=>await marker()!==before);
  assert.match(await readFile(resolve(root,'vscode/dist/webview.js'),'utf8'),/watch-updated/);
  const good=await marker();
  await writeFile(fixture,'export default ;');
  await until(()=>output.includes('ERROR'));
  assert.equal(await marker(),good,'Failed build must not replace the reload marker');
  await writeFile(fixture,'export default {get:()=>undefined,marker:"watch-recovered"};');
  await until(async()=>await marker()!==good);
  assert.match(await readFile(resolve(root,'vscode/dist/webview.js'),'utf8'),/watch-recovered/);
  console.log('Watch rebuild, successful reload marker and compile-error recovery passed.');
}finally{
  const exited=new Promise(resolve=>child.once('close',resolve));child.kill();await exited;
}
