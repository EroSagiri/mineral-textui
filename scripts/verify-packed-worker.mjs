import {spawn} from 'node:child_process';
import {mkdir, copyFile, writeFile, readFile, realpath} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, '.artifacts', `worker-consumer-${Date.now()}`);
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run through pnpm test:packed-worker');
async function pnpm(args, cwd = root) {
  const child = /\.(?:c?js|mjs)$/.test(cli) ? spawn(process.execPath,[cli,...args],{cwd,windowsHide:true}) : spawn(cli,args,{cwd,windowsHide:true});
  let output = '';
  child.stdout.on('data',chunk => {output += chunk;}); child.stderr.on('data',chunk => {output += chunk;});
  const code = await new Promise((done, fail) => {child.once('error', fail); child.once('exit', done);});
  assert.equal(code,0,output); return output;
}
await mkdir(join(directory,'worker-app'),{recursive:true});
await mkdir(join(directory,'task-app'),{recursive:true});
for (const name of ['textui','textui-react']) await pnpm(['pack','--pack-destination',directory],join(root,'packages',name));
const core = JSON.parse(await readFile(join(root,'packages/textui/package.json'),'utf8'));
const react = JSON.parse(await readFile(join(root,'packages/textui-react/package.json'),'utf8'));
await writeFile(join(directory,'package.json'),JSON.stringify({name:'independent-worker-consumer',private:true,type:'module',dependencies:{
  '@mineral/textui':`file:./mineral-textui-${core.version}.tgz`,
  '@mineral/textui-react':`file:./mineral-textui-react-${react.version}.tgz`,
  react:'19.3.0','react-router':'8.4.0',
},pnpm:{overrides:{'@mineral/textui':`file:./mineral-textui-${core.version}.tgz`}}}));
await pnpm(['install','--ignore-workspace','--ignore-scripts'],directory);
for (const name of ['textui','textui-react']) {
  const installed = await realpath(join(directory,'node_modules/@mineral',name));
  assert(installed.startsWith(directory), `Consumer resolved workspace package: ${installed}`);
}
for (const name of ['worker.ts','screen-port.ts','wrangler.jsonc']) await copyFile(join(root,'examples/worker-app',name),join(directory,'worker-app',name));
await copyFile(join(root,'examples/task-app/app.tsx'),join(directory,'task-app/app.tsx'));
await copyFile(join(root,'tests/phase-6-probe.tsx'),join(directory,'phase-6-probe.tsx'));
const packedWorker=join(directory,'worker-app/worker.ts');
await writeFile(packedWorker,"import {verifyPhase6} from '../phase-6-probe.tsx';\n"+(await readFile(packedWorker,'utf8')).replace('async fetch(request: Request, env: Env): Promise<Response> {',"async fetch(request: Request, env: Env): Promise<Response> {\n    if(new URL(request.url).pathname==='/phase6')return Response.json(await verifyPhase6());"));
const config = JSON.parse(await readFile(join(directory,'worker-app/wrangler.jsonc'),'utf8'));
delete config.$schema;
await writeFile(join(directory,'worker-app/wrangler.jsonc'),JSON.stringify(config));
async function freePort() {
  const server = createServer(); await new Promise(done => server.listen(0,'127.0.0.1',done));
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
const port = await freePort(), inspector = await freePort();
const worker = spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspector),'--show-interactive-dev-session=false'],{
  cwd:join(directory,'worker-app'),windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe'],
});
let output = '';
worker.stdout.on('data',chunk => {output += chunk;}); worker.stderr.on('data',chunk => {output += chunk;});
const exited = new Promise(done => worker.once('exit',done));
const url = `http://127.0.0.1:${port}/apps/packed/screen`;
try {
  const deadline = Date.now()+90000;
  let response;
  while (Date.now()<deadline) {
    if (worker.exitCode !== null) throw new Error(output);
    try {response = await fetch(url,{signal:AbortSignal.timeout(5000)}); break;} catch {await delay(250);}
  }
  assert(response,output); assert.equal(response.status,200,await response.clone().text());
  const home = await response.json(); assert(home.screen.text.includes('今天还有 3 项任务待完成'));
  const taskResponse = await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({text:home.screen.text.replace('- [ ] 任务列表','- [x] 任务列表'),expectedRevision:home.screen.revision})}); assert.equal(taskResponse.status,200);
  const tasks = (await taskResponse.json()).screen;
  const text = tasks.text.replace('- [ ] 完成原型','- [x] 完成原型').replace('- [ ] 首页','- [x] 首页'); assert.notEqual(text,tasks.text);
  const edited = await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({text,expectedRevision:tasks.revision})});
  assert.equal(edited.status,200,await edited.clone().text());
  assert.deepEqual((await edited.json()).events.map(value=>value.event.target),['nav-home','prototype']);
  const updated = await (await fetch(url)).json(); assert(updated.screen.text.includes('今天还有 2 项任务待完成'));assert.equal(updated.screen.id,home.screen.id);
  const phase6Response=await fetch(`http://127.0.0.1:${port}/phase6`);assert.equal(phase6Response.status,200,await phase6Response.clone().text());
  assert.equal((await phase6Response.json()).ok,true);
  console.log(JSON.stringify({phase6:true,ok:true,installedTarballs:true,workspaceLinks:false,nodeCompatibility:false,derivedState:true,consumer:directory},null,2));
} finally {worker.kill(); await exited;}
