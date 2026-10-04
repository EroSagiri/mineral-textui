import {createServer as createHttpServer} from 'node:http';
import {resolve,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as createViteServer} from 'vite';
import {WebSocket,WebSocketServer} from 'ws';
import {createNodeHost} from '@mineral/textui-host-node';
import {ScreenConflictError} from '@mineral/textui';
import type {ScreenPort} from '@mineral/textui';
import {render} from '@mineral/textui-react';
import {UserForm} from '../../examples/user-form/app.tsx';
import {AdvancedForm} from '../../examples/phase-6/advanced-form.tsx';
import {createTaskApp} from '../../examples/task-app/app.tsx';
import {createAnimationApp} from '../../examples/animation-demo/app.tsx';
import {readAnimation,renderFrame} from '../../examples/animation-demo/animation.ts';
import {systemClock} from '../../examples/animation-demo/clock.ts';
import type {TextFrame} from '../../examples/worker-animation/frame-stream.ts';
import {createElement} from 'react';

export async function startDevTools(options:{port?:number;directory?:string;open?:boolean;app?:string;preview?:string}={}) {
  const directory=resolve(options.directory??process.env.TEXTUI_DEVTOOLS_DIRECTORY??'../screens/devtools');
  const host=createNodeHost(directory,{onError:console.error});
  const streamHost=createNodeHost(resolve(directory,'stream'),{onError:console.error});
  const lowHost=createNodeHost(resolve(directory,'persistent'),{onError:console.error});
  const user=await render(<UserForm/>,{host,screen:'user',onError:console.error});
  const advanced=await render(<AdvancedForm/>,{host,screen:'advanced-form',onError:console.error});
  const tasks=await createTaskApp(host,{onError:console.error});
  await tasks.idle();
  const stream=await createAnimationApp(streamHost,systemClock,{stream:true,onError:console.error});
  const low=await createAnimationApp(lowHost,systemClock,{onError:console.error});
  await stream.startScheduling();await low.startScheduling();
  const screens=new Map<string,{host:ScreenPort;id:string}>([
    ['user',{host,id:'user'}],['advanced-form',{host,id:'advanced-form'}],['task-app',{host,id:tasks.screen}],
    ['build',{host:streamHost,id:'build'}],['low-build',{host:lowHost,id:'build'}],
  ]);
  const workers={
    'worker-task':process.env.TEXTUI_DEVTOOLS_WORKER_TASK_URL??'http://127.0.0.1:8787/apps/demo',
    'worker-animation':process.env.TEXTUI_DEVTOOLS_WORKER_ANIMATION_URL??'http://127.0.0.1:8788/apps/demo',
  };
  const root=basename(import.meta.dirname)==='.artifacts'?resolve(import.meta.dirname,'..'):import.meta.dirname;
  let vite:Awaited<ReturnType<typeof createViteServer>>;
  const sockets=new WebSocketServer({noServer:true,maxPayload:1024*1024});
  const cleanups=new Set<()=>void>();
  const metrics:Record<string,{writes:number;frames:number}>={};
  const metricUnsubscribes:(()=>void)[]=[];
  for(const [id,target] of screens){
    metrics[id]={writes:0,frames:0};
    metricUnsubscribes.push(await target.host.onScreenChange(target.id,()=>{metrics[id].writes++;}));
  }
  let sequence=0;
  const dev={reloads:0,reloading:false,error:''};
  const server=createHttpServer(async(req,res)=>{
    const path=new URL(req.url??'/', 'http://localhost').pathname;
    if(!path.startsWith('/api/')){vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});return;}
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    // This development service only accepts same-origin browser writes.
    if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host){json(403,{error:'Origin rejected'});return;}
    try {
      if(path==='/api/config'){json(200,{screens:[...screens.keys()],directory,workers,defaultScreen:appPath?'project':'task-app',app:appPath,dev});return;}
      if(path==='/api/metrics'){json(200,metrics);return;}
      const match=/^\/api\/(node|worker-task|worker-animation)\/screens\/([\w-]+)$/.exec(path);
      if(!match){json(404,{error:'Not found'});return;}
      if(!['GET','PUT'].includes(req.method??'')){json(405,{error:'Method not allowed'});return;}
      let body='';
      if(req.method==='PUT')for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>1024*1024){json(413,{error:'Document too large'});return;}}
      if(match[1]!=='node'){
        if(match[1]==='worker-task' && match[2]!=='task-app'){json(404,{error:'Unknown application'});return;}
        const suffix=match[1]==='worker-task'?'/screen':`/screens/${match[2]}`;
        const response=await fetch(`${workers[match[1] as keyof typeof workers]}${suffix}`,{method:req.method,headers:{'Content-Type':'application/json'},body:req.method==='PUT'?body:undefined,signal:AbortSignal.timeout(10000)});
        const data=await response.json();if(data.screen)data.screen.id=match[2];json(response.status,data);return;
      }
      const target=screens.get(match[2]);if(!target){json(404,{error:'Unknown screen'});return;}
      if(req.method==='GET'){const snapshot=await target.host.getScreen(target.id);json(200,{screen:snapshot?{...snapshot,id:match[2]}:null});return;}
      const data:unknown=JSON.parse(body);
      if(!data || typeof data!=='object' || !('text' in data) || typeof data.text!=='string' || !('expectedRevision' in data) || typeof data.expectedRevision!=='string'){json(400,{error:'text and expectedRevision required'});return;}
      const saved=await target.host.setScreen(target.id,data.text,{expectedRevision:data.expectedRevision,origin:'devtools'});
      json(200,{screen:{...saved,id:match[2]}});
    } catch(error){
      if(error instanceof ScreenConflictError)json(409,{error:error.name,actualRevision:error.actualRevision});
      else json(error instanceof SyntaxError?400:502,{error:error instanceof Error?error.message:String(error)});
    }
  });
  let project:Awaited<ReturnType<typeof render>>|undefined;
  let reloadTail=Promise.resolve(),closing=false;
  const appPath=(options.app??process.env.TEXTUI_DEVTOOLS_APP)?resolve((options.app??process.env.TEXTUI_DEVTOOLS_APP)!).replaceAll('\\','/'):null;
  const previewPath=(options.preview??process.env.TEXTUI_DEVTOOLS_PREVIEW)?resolve((options.preview??process.env.TEXTUI_DEVTOOLS_PREVIEW)!):null;
  vite=await createViteServer({root,configFile:false,plugins:[{
    name:'textui-project-preview',
    async handleHotUpdate(ctx){
      if(!appPath || !project || closing)return;
      const entry=vite.moduleGraph.getModuleById(appPath),seen=new Set();
      const depends=(node:typeof entry):boolean=>{
        if(!node || seen.has(node))return false;seen.add(node);
        return node.file===ctx.file || [...node.ssrImportedModules].some(depends);
      };
      if(!depends(entry))return;
      await ctx.read();
      reloadTail=reloadTail.then(async()=>{
        if(closing)return;
        dev.reloading=true;dev.error='';vite.ws.send({type:'custom',event:'textui:app-status',data:dev});
        try{
          for(const module of ctx.modules)vite.moduleGraph.invalidateModule(module);
          if(entry)vite.moduleGraph.invalidateModule(entry);
          const module=await vite.ssrLoadModule(appPath);
          if(typeof module.default!=='function')throw new Error('App must export a React component');
          await project!.update(createElement(module.default));
          dev.reloads++;console.log('TextUI App reloaded');
        }catch(error){dev.error=String(error);console.error('TextUI App reload failed',error);}
        finally{dev.reloading=false;vite.ws.send({type:'custom',event:'textui:app-status',data:dev});}
      });
      await reloadTail;
      // Screen subscriptions update the editor; avoid browser reload and lost dirty buffers.
      return ctx.modules.filter(module=>module.transformResult);
    },
    resolveId(id){if(id==='virtual:textui-preview')return '\0textui-preview';},
    load(id){if(id==='\0textui-preview')return previewPath?`export {default} from ${JSON.stringify(previewPath.replaceAll('\\','/'))};`:'export default undefined;';},
  }],ssr:{external:['react','react/jsx-runtime','@mineral/textui','@mineral/textui-react','@mineral/textui-host-node']},server:{middlewareMode:true,hmr:{server,path:'/__vite_hmr'}},appType:'spa'});
  // An application entry remains an ordinary React app with the existing injected Host.
  if(appPath){
    const module=await vite.ssrLoadModule(appPath);
    if(typeof module.default!=='function')throw new Error('TEXTUI_DEVTOOLS_APP must export a React component as default');
    project=await render(createElement(module.default),{host,screen:'project',onError:console.error});
    screens.set('project',{host,id:'project'});metrics.project={writes:0,frames:0};
    metricUnsubscribes.push(await host.onScreenChange('project',()=>{metrics.project.writes++;}));
  }
  server.on('upgrade',(req,socket,head)=>{
    if(new URL(req.url??'/','http://localhost').pathname==='/__vite_hmr')return;
    const match=/^\/api\/(node|worker-task|worker-animation)\/screens\/([\w-]+)\/subscribe$/.exec(new URL(req.url??'/','http://localhost').pathname);
    if(!match || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)){socket.destroy();return;}
    sockets.handleUpgrade(req,socket,head,client=>{
      if(match[1]!=='node'){
        if(match[1]==='worker-task' && match[2]!=='task-app'){client.close(1008,'Unknown application');return;}
        const suffix=match[1]==='worker-task'?'/screen':`/screens/${match[2]}`;
        const upstream=new WebSocket(`${workers[match[1] as keyof typeof workers].replace(/^http/,'ws')}${suffix}/subscribe`);
        const cleanup=()=>{upstream.close(1000,'Client closed');cleanups.delete(cleanup);};cleanups.add(cleanup);
        upstream.on('message',data=>{if(client.readyState===WebSocket.OPEN)client.send(data.toString());});
        upstream.on('open',()=>{if(client.readyState!==WebSocket.OPEN)upstream.close(1000,'Client closed');else client.send(JSON.stringify({type:'ready'}));});
        upstream.on('error',()=>client.close(1011,'Worker unavailable'));
        upstream.on('close',()=>client.close(1012,'Worker disconnected'));
        client.on('close',cleanup);client.on('error',cleanup);return;
      }
      const target=screens.get(match[2]);if(!target){client.close(1008,'Unknown screen');return;}
      let unsubscribe:(()=>void)|undefined, timer:ReturnType<typeof setInterval>|undefined,closed=false;
      const send=(value:unknown)=>{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(value));};
      const cleanup=()=>{closed=true;unsubscribe?.();clearInterval(timer);cleanups.delete(cleanup);};cleanups.add(cleanup);
      client.on('close',cleanup);client.on('error',cleanup);
      void (async()=>{
        unsubscribe=await target.host.onScreenChange(target.id,()=>send({type:'change'}));
        if(closed){unsubscribe();return;}
        // Ready is emitted only after subscription is established; client then reads a snapshot.
        send({type:'ready'});
        if(match[2]==='build'){
          let busy=false;
          timer=setInterval(()=>{if(busy || closed)return;busy=true;void (async()=>{
            const snapshot=await streamHost.getScreen('build');if(!snapshot)return;
            const state=readAnimation(snapshot.text);if(state.status!=='running')return;
            const frame:TextFrame={screenId:'build',targetId:'progress',animationId:state.id,sequence:++sequence,baseRevision:snapshot.revision,generatedAt:Date.now(),markdown:renderFrame(state,Date.now())};
            metrics.build.frames++;
            send({type:'frame',frame});
          })().catch(console.error).finally(()=>{busy=false;});},250);
        }
      })().catch(()=>client.close(1011,'Subscription failed'));
    });
  });
  const port=options.port??Number(process.env.TEXTUI_DEVTOOLS_PORT??5173);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve());});
  const address=server.address();const url=`http://127.0.0.1:${typeof address==='object' && address?address.port:port}`;
  console.log(`DevTools：${url}\n文件目录：${directory}\n默认进入 Markdown 编辑器，500ms 自动保存；Ctrl+C 关闭服务。`);
  if(options.open!==false){
    // Launch the user's browser, passing a fixed local URL as an argument.
    const command=process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`Start-Process '${url}' -WindowStyle Normal`]:[url];
    const child=spawn(command,args,{stdio:'ignore',detached:true,windowsHide:true});child.on('error',()=>console.warn(`请在浏览器打开 ${url}`));child.unref();
  }
  return {url,directory,async close(){
    if(closing)return;closing=true;await reloadTail;
    for(const cleanup of cleanups)cleanup();for(const client of sockets.clients)client.terminate();sockets.close();
    for(const unsubscribe of metricUnsubscribes)unsubscribe();
    await vite.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await Promise.all([project?.unmount(),user.unmount(),advanced.unmount(),tasks.close(),stream.close(),low.close()]);
    await Promise.all([host.close(),streamHost.close(),lowHost.close()]);
  }};
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){
  const args=process.argv.slice(2);
  if(args.includes('--help'))console.log('用法：pnpm devtools [--app app.tsx] [--preview preview.ts] [--no-open]\n保存 App 及其依赖后自动重载。路径相对于启动命令的目录。');
  else {
    const options:{open:boolean;app?:string;preview?:string}={open:true};
    for(let i=0;i<args.length;i++){
      if(args[i]==='--no-open'){options.open=false;continue;}
      if(args[i]==='--app' || args[i]==='--preview'){
        const name=args[i].slice(2) as 'app'|'preview',value=args[++i];
        if(!value || value.startsWith('--'))throw new Error(`Missing --${name} path`);
        options[name]=resolve(process.env.INIT_CWD??process.cwd(),value);continue;
      }
      throw new Error('无效参数；使用 --help 查看用法');
    }
    const service=await startDevTools(options);
    const stop=()=>{void service.close().catch(error=>{console.error(error);process.exitCode=1;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }
}
