import {ScreenConflictError} from '@mineral/textui';
import type {DevtoolsSession,DevtoolsObservation} from './api.js';
import {observeScreenPort} from './api.js';

/** Portable HTTP half of the development protocol; Node and Worker supply their own WS upgrade. */
export function createDevtoolsBridge(session:DevtoolsSession,options:{enabled:boolean;instanceId:string;token?:string;observation?:DevtoolsObservation}){
  const observation=options.observation??{known:new Set<string>(),events:[]};
  const port=observeScreenPort(session.port,observation);
  const config=async()=>{
    const screens=new Map((session.screens??[]).map(screen=>[screen.id,screen]));
    for(const screen of await session.discovery?.listScreens()??[])screens.set(screen.id,screen);
    for(const id of observation.known)if(!screens.has(id))screens.set(id,{id});
    return {session:{id:options.instanceId,label:session.label??session.id??'development',mode:session.mode??'local'},screens:[...screens.values()],defaultScreen:screens.keys().next().value??null};
  };
  const authorized=(request:Request)=>options.enabled && (!options.token || request.headers.get('Authorization')===`Bearer ${options.token}`);
  async function handleRequest(request:Request):Promise<Response>{
    const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(!options.enabled)return json(404,{error:'Development Bridge disabled'});
    if(!authorized(request))return json(401,{error:'Unauthorized'});
    if(request.headers.has('X-TextUI-Session') && request.headers.get('X-TextUI-Session')!==options.instanceId)return json(412,{error:'Development session replaced'});
    if(request.headers.get('Origin') && request.headers.get('Origin')!==new URL(request.url).origin)return json(403,{error:'Origin rejected'});
    const path=new URL(request.url).pathname;
    try{
      if(path==='/config' && request.method==='GET')return json(200,await config());
      if(path==='/inspect' && request.method==='GET')return json(200,{events:observation.events,inspection:await session.inspect?.()??{}});
      const match=/^\/screens\/([^/]+)$/.exec(path);
      if(!match)return json(404,{error:'Not found'});
      const id=decodeURIComponent(match[1]);
      if(request.method==='GET')return json(200,{screen:await port.getScreen(id)});
      if(request.method!=='PUT')return json(405,{error:'Method not allowed'});
      const reader=request.body?.getReader();let body='',bytes=0;const decoder=new TextDecoder();
      if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1024*1024){await reader.cancel();return json(413,{error:'Document too large'});}body+=decoder.decode(chunk.value,{stream:true});}
      body+=decoder.decode();const value:unknown=JSON.parse(body);
      if(!value || typeof value!=='object' || !('text' in value) || typeof value.text!=='string' || !('expectedRevision' in value) || (value.expectedRevision!==null && typeof value.expectedRevision!=='string'))return json(400,{error:'text and expectedRevision required'});
      return json(200,{screen:await port.setScreen(id,value.text,{expectedRevision:value.expectedRevision as string|null,origin:'devtools'})});
    }catch(error){
      if(error instanceof ScreenConflictError)return json(409,{error:error.message,actualRevision:error.actualRevision});
      return json(error instanceof SyntaxError || error instanceof URIError?400:500,{error:String(error)});
    }
  }
  /** Host supplies its own WebSocket upgrade and checks authorized(request) first. */
  async function subscribeScreen(id:string,send:(message:unknown)=>void){
    if(!options.enabled)throw new Error('Development Bridge disabled');
    let active=true;
    const deliver=(message:unknown)=>{if(active)send(message);};
    const unsubscribe=await port.onScreenChange(id,()=>deliver({type:'change'}));
    let unframe:(()=>void)|undefined;
    try{unframe=await session.subscribeFrames?.(id,frame=>deliver({type:'frame',frame}));deliver({type:'ready'});}
    catch(error){active=false;unsubscribe();throw error;}
    return ()=>{active=false;unsubscribe();unframe?.();};
  }
  return {port,config,observation,authorized,handleRequest,subscribeScreen};
}
