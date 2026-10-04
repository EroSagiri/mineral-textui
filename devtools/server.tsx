import {createServer as createHttpServer} from 'node:http';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createServer as createViteServer} from 'vite';
import {WebSocket,WebSocketServer} from 'ws';
import {MemoryScreen} from '@mineral/textui';
import {createElement} from 'react';
import {render} from '@mineral/textui-react';
import {createDevtoolsBridge} from './src/bridge.js';
import {observeScreenPort} from './src/api.js';
import type {DevtoolsSession,DevtoolsConfiguration,DevtoolsContext,DevtoolsObservation} from './src/api.js';

export interface DevtoolsOptions {projectRoot?:string;port?:number;app?:string;config?:string;preview?:string;connect?:string;mode?:'sandbox'|'local'}
export async function startDevtools(options:DevtoolsOptions={}){
  const projectRoot=resolve(options.projectRoot??process.cwd());
  const location=dirname(fileURLToPath(import.meta.url));
  const toolRoot=['dist','.artifacts'].includes(basename(location))?dirname(location):location;
  const absolute=(path:string)=>resolve(projectRoot,path).replaceAll('\\','/');
  const configPath=options.config?absolute(options.config):['textui.dev.ts','textui.dev.tsx','textui.dev.js'].map(absolute).find(existsSync);
  const appPath=options.app?absolute(options.app):undefined;
  if(!configPath && !appPath && !options.connect)throw new Error('Provide --app <app.tsx>, --config <textui.dev.ts>, or --connect <Bridge URL>.');
  const observation:DevtoolsObservation={known:new Set(),events:[]};
  let session:DevtoolsSession,configuration:DevtoolsConfiguration={},instance=randomUUID(),previewPath:string|undefined,remoteInstance:string|undefined;
  let bridge:ReturnType<typeof createDevtoolsBridge>;
  let sessionActive=false;
  const dev={reloads:0,reloading:false,error:''};
  let closing=false;
  const cleanups=new Set<()=>void>();
  let reloadTail=Promise.resolve();
  const http=createHttpServer((req,res)=>{void serve(req,res).catch(error=>{if(!res.headersSent)res.writeHead(400);res.end(String(error));});});
  const sockets=new WebSocketServer({noServer:true});
  // Stabilize rapid editor writes; the watcher's ordinary 50ms throttle can miss a correction.
  const vite=await createViteServer({root:toolRoot,configFile:false,server:{middlewareMode:true,watch:{awaitWriteFinish:{stabilityThreshold:80,pollInterval:10}},hmr:{server:http,path:'/__vite_hmr'},fs:{allow:[toolRoot,projectRoot],deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/textui.dev.*',...(configPath?[configPath]:[])]}},
    ssr:{external:['react','react/jsx-runtime','@mineral/textui','@mineral/textui-react','@mineral/textui-devtools']},
    plugins:[{name:'textui-development-session',resolveId(id){if(id==='virtual:textui-preview')return '\0textui-preview';},
      load(id){if(id==='\0textui-preview')return previewPath?`export {default} from ${JSON.stringify(previewPath)};`:'export default undefined;';},
      async handleHotUpdate(ctx){
        const roots=[configPath,session?.entry?absolute(session.entry):undefined].filter((x):x is string=>!!x);
        const file=ctx.file.replaceAll('\\','/');
        const depends=(path:string,seen=new Set<string>()):boolean=>{
          if(path===file)return true;if(seen.has(path))return false;seen.add(path);
          const module=vite.moduleGraph.getModuleById(path);
          return [...module?.ssrImportedModules??[]].some(child=>!!child.file && depends(child.file.replaceAll('\\','/'),seen));
        };
        const configurationChanged=!!configPath && depends(configPath) && (file===configPath || !session?.entry || !depends(absolute(session.entry)));
        if(!roots.some(root=>depends(root)))return;
        await ctx.read();
        reloadTail=reloadTail.then(async()=>{
          dev.reloading=true;dev.error='';broadcast();
          try{
            for(const module of ctx.modules)vite.moduleGraph.invalidateModule(module);
            for(const root of roots){const module=vite.moduleGraph.getModuleById(root);if(module)vite.moduleGraph.invalidateModule(module);}
            if(configPath && configurationChanged){
              // Compile first; syntax errors leave the running session and editor intact.
              await context.loadModule(configPath);
              const previous=session;
              sessionActive=false;instance=randomUUID();
              for(const cleanup of cleanups)cleanup();
              for(const socket of sockets.clients)socket.close(1012,'Session replaced');
              await dispose(previous);
              // Release old storage subscriptions before opening another runtime on the same Host.
              observation.known.clear();observation.events.length=0;await createSession();sessionActive=true;
              bridge=createDevtoolsBridge(session,{enabled:true,instanceId:instance,observation});
              const module=vite.moduleGraph.getModuleById('\0textui-preview');if(module)vite.moduleGraph.invalidateModule(module);
              vite.ws.send({type:'custom',event:'textui:session',data:{instance}});
            }else if(session.reload)await session.reload(context);
            else if(session.entry && session.app?.update){const module=await context.loadModule(session.entry);await session.app.update(createElement(module.default));}
            else throw new Error('This session must provide entry + app.update, or reload(context), for application hot reload.');
            dev.reloads++;
          }catch(error){dev.error=String(error);}finally{dev.reloading=false;broadcast();}
        });
        await reloadTail;
        return ctx.modules.filter(module=>module.transformResult);
      }}]});
  const context:DevtoolsContext={projectRoot,mode:options.mode??'local',observePort:port=>observeScreenPort(port,observation),loadModule:path=>vite.ssrLoadModule(absolute(path))};
  const disposed=new WeakSet<DevtoolsSession>();
  async function dispose(value:DevtoolsSession|undefined){if(!value || disposed.has(value))return;disposed.add(value);if(value.close)await value.close();else if(value.app?.unmount)await value.app.unmount();else await value.app?.close?.();}
  async function createSession(){
    const candidate:DevtoolsConfiguration=configPath?(await context.loadModule(configPath)).default:options.connect?{remote:{url:options.connect}}:{};
    if(!candidate || typeof candidate!=='object')throw new Error('Configuration must export defineDevtools({...}) as default.');
    let next:DevtoolsSession;
    if(candidate.remote)next={port:new MemoryScreen(),mode:'remote',label:'Remote Runtime'};
    else if(candidate.createSession){
      const requested=options.mode??candidate.mode??'local';
      next=await candidate.createSession({...context,mode:requested});
      if(requested==='sandbox' && next.mode!=='sandbox'){await dispose(next);throw new Error('Sandbox factories must explicitly return mode: sandbox and mock external side effects.');}
    }else if(appPath){
      if(options.mode==='local')throw new Error('--app uses sandbox memory storage; provide createSession for a local Host.');
      const port=context.observePort(new MemoryScreen()),module=await context.loadModule(appPath);
      const app=await render(createElement(module.default),{host:port,screen:'main',onError:error=>{dev.error=String(error);broadcast();}});
      next={port,app,entry:appPath,mode:'sandbox',label:'Sandbox Preview',screens:[{id:'main'}],inspect:()=>({state:Object.fromEntries(app.store.snapshot())})};
    }else throw new Error('Configuration needs createSession or remote.');
    if(!next?.port || ['getScreen','setScreen','onScreenChange'].some(method=>typeof (next.port as any)[method]!=='function')){await dispose(next);throw new Error('Session must provide a ScreenPort.');}
    configuration=candidate;session=next;
    previewPath=options.preview?absolute(options.preview):candidate.preview?absolute(candidate.preview):next.preview?absolute(next.preview):undefined;
  }
  function broadcast(){vite.ws.send({type:'custom',event:'textui:app-status',data:dev});}
  function remoteURL(path:string){return configuration.remote!.url.replace(/\/$/,'')+path;}
  async function dispatch(path:string,method:string,body?:string){
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(configuration.remote?.token)headers.Authorization=`Bearer ${configuration.remote.token}`;
    if(configuration.remote && remoteInstance && path!=='/config')headers['X-TextUI-Session']=remoteInstance;
    const request={method,headers,body,signal:AbortSignal.timeout(10000)};
    return configuration.remote?fetch(remoteURL(path),request):bridge.handleRequest(new Request(`http://localhost${path}`,request));
  }
  async function serve(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse){
    // Session factories and their server-only imports must not be served as browser modules.
    const pathname=new URL(req.url??'/','http://localhost').pathname;
    const requested=resolve(pathname.startsWith('/@fs/')?decodeURIComponent(pathname.slice(5)):resolve(toolRoot,'.'+decodeURIComponent(pathname))).replaceAll('\\','/');
    const serverOnly=(path:string,seen=new Set<string>()):boolean=>{
      if(path===requested)return true;if(seen.has(path))return false;seen.add(path);
      return [...vite.moduleGraph.getModuleById(path)?.ssrImportedModules??[]].some(module=>!!module.file && serverOnly(module.file.replaceAll('\\','/'),seen));
    };
    if(configPath && serverOnly(configPath)){res.statusCode=403;res.end('Server-only development configuration');return;}
    if(!req.url?.startsWith('/api/'))return vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected'});
    // Loopback binding plus Host validation prevents DNS-rebinding access to local sessions.
    if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host??''))return send(403,{error:'Host rejected'});
    if(!sessionActive)return send(503,{error:dev.error || 'Development session is restarting'});
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/api/config'){
        const response=await dispatch('/config','GET');const config=await response.json();
        if(!response.ok)return send(response.status,config);
        if(configuration.remote){remoteInstance=config.session.id;config.session.id=`${instance}:${remoteInstance}`;config.session.mode='remote';}
        return send(200,{...config,app:session.entry,dev});
      }
      const target=path==='/api/inspect'?'/inspect':path.startsWith('/api/runtime/')?path.slice('/api/runtime'.length):undefined;
      if(!target)return send(404,{error:'Not found'});
      const activeInstance=configuration.remote?`${instance}:${remoteInstance}`:instance;
      if(req.headers['x-textui-session'] && req.headers['x-textui-session']!==activeInstance)return send(412,{error:'Development session replaced'});
      let body:string|undefined;
      if(req.method==='PUT'){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return send(413,{error:'Document too large'});chunks.push(chunk);}body=Buffer.concat(chunks).toString('utf8');}
      const response=await dispatch(target,req.method??'GET',body);
      res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());
    }catch(error){send(500,{error:String(error)});}
  }
  http.on('upgrade',(req,socket,head)=>{
    const url=new URL(req.url??'/','http://localhost'),match=/^\/api\/runtime\/screens\/([^/]+)\/subscribe$/.exec(url.pathname);if(!match)return;
    if(!sessionActive){socket.destroy();return;}
    if(url.searchParams.has('session') && url.searchParams.get('session')!==(configuration.remote?`${instance}:${remoteInstance}`:instance)){socket.destroy();return;}
    if((req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host??'')){socket.destroy();return;}
    sockets.handleUpgrade(req,socket,head,ws=>{void subscribe(ws,match[1]);});
  });
  async function subscribe(ws:WebSocket,encoded:string){
    let stopped=false,unsubscribe:(()=>void)|undefined,unframe:(()=>void)|undefined,upstream:WebSocket|undefined;
    const cleanup=()=>{if(stopped)return;stopped=true;unsubscribe?.();unframe?.();upstream?.close();cleanups.delete(cleanup);};
    cleanups.add(cleanup);ws.on('close',cleanup);ws.on('error',cleanup);
    const send=(value:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
    try{
      if(configuration.remote){
        upstream=new WebSocket(remoteURL(`/screens/${encoded}/subscribe`).replace(/^http/,'ws'),{headers:configuration.remote.token?{Authorization:`Bearer ${configuration.remote.token}`}:{}});
        upstream.on('message',data=>{if(ws.readyState===WebSocket.OPEN)ws.send(data.toString());});
        upstream.on('close',()=>{ws.close();});upstream.on('error',()=>ws.close(1011));
      }else{
        const current=bridge,active=session,id=decodeURIComponent(encoded);
        unsubscribe=await current.port.onScreenChange(id,()=>send({type:'change'}));
        if(stopped){unsubscribe();return;}
        unframe=await active.subscribeFrames?.(id,frame=>send({type:'frame',frame}));
        if(stopped){unframe?.();return;}send({type:'ready'});
      }
    }catch(error){send({type:'error',error:String(error)});ws.close(1011);cleanup();}
  }
  try{await createSession();sessionActive=true;bridge=createDevtoolsBridge(session!,{enabled:true,instanceId:instance,observation});await new Promise<void>((done,reject)=>{http.once('error',reject);http.listen(options.port??5173,'127.0.0.1',done);});}
  catch(error){await vite.close();sockets.close();await dispose(session!);throw error;}
  const address=http.address() as import('node:net').AddressInfo;
  // Discovery stays application-owned; polling only notices an existing remote Host replacement.
  let checking=false;
  const poll=configuration.remote?setInterval(()=>{if(checking || closing)return;checking=true;void dispatch('/config','GET').then(async response=>{
    if(!response.ok)return;const value=await response.json();const next=value.session?.id;
    if(typeof next==='string' && remoteInstance && next!==remoteInstance){remoteInstance=next;for(const cleanup of cleanups)cleanup();for(const socket of sockets.clients)socket.close(1012,'Remote session replaced');vite.ws.send({type:'custom',event:'textui:session',data:{instance}});}
  }).catch(()=>{}).finally(()=>{checking=false;} );},1000):undefined;
  poll?.unref();
  return {url:`http://127.0.0.1:${address.port}`,async close(){closing=true;clearInterval(poll);await reloadTail;for(const cleanup of cleanups)cleanup();for(const socket of sockets.clients)socket.terminate();sockets.close();await vite.close();await new Promise<void>(done=>http.close(()=>done()));await dispose(session);}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2).filter(arg=>arg!=='dev'),options:DevtoolsOptions={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--help'){console.log('textui dev [--app app.tsx | --config textui.dev.ts | --connect BridgeURL] [--preview preview.ts] [--port 5173] [--mode sandbox|local]');process.exit(0);}
    if(args[i]==='--no-open')continue;
    const key=args[i].slice(2);if(!['app','config','connect','preview','port','mode','projectRoot'].includes(key) || !args[i+1])throw new Error(`Unknown option ${args[i]}`);
    (options as any)[key]=key==='port'?Number(args[++i]):args[++i];
  }
  if(options.mode && !['sandbox','local'].includes(options.mode))throw new Error('mode must be sandbox or local');
  options.projectRoot??=process.env.INIT_CWD??process.cwd();
  startDevtools(options).then(server=>{console.log(`Mineral Devtools: ${server.url}`);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void server.close().then(()=>process.exit(0));});}).catch(error=>{console.error(String(error));process.exitCode=1;});
}
