import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),directory=join(root,'.artifacts','preview'),cli=process.env.npm_execpath;
if(!cli)throw new Error('Run through pnpm pack:preview');
await mkdir(directory,{recursive:true});
for(const name of ['textui','textui-react','textui-host-node']){
  const child=spawn(/\.(?:c?js|mjs)$/.test(cli)?process.execPath:cli,/\.(?:c?js|mjs)$/.test(cli)?[cli,'pack','--pack-destination',directory]:['pack','--pack-destination',directory],{cwd:join(root,'packages',name),windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw new Error(`Pack failed: ${name}`);
}
console.log(`Preview tarballs: ${directory}`);
