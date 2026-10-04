import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const directory=fileURLToPath(new URL('.',import.meta.url));
const config=JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
assert.deepEqual(config.compatibility_flags,['no_nodejs_compat','no_nodejs_compat_v2']);
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const port=await freePort(),inspectorPort=await freePort();
const child=spawn(process.execPath,[fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','--local','--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspectorPort),'--show-interactive-dev-session=false'],{cwd:directory,windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
const exited=new Promise(resolve=>child.once('exit',resolve));
try {
  const deadline=Date.now()+90000;let response;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Wrangler exited (${child.exitCode}):\n${output}`);
    try{response=await fetch(`http://127.0.0.1:${port}/verify`,{signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});break;}catch{await delay(300);}
  }
  if(!response)throw new Error(`Wrangler runtime did not start:\n${output}`);
  const body=await response.text();assert.equal(response.status,200,`${body.slice(0,2000)}\n${output.slice(-5000)}`);
  const result=JSON.parse(body);assert.equal(result.ok,true);assert.equal(result.nodeCompatibility,false);assert.equal(result.mainCount,1);assert.equal(result.previewCount,1);assert.equal(result.conflictDetected,true);
  assert.equal(result.markdownComponents,true);assert.equal(result.customBlocks,true);assert.equal(result.phase6.ok,true);
  console.log(JSON.stringify(result,null,2));
} finally{child.kill();await exited;}
