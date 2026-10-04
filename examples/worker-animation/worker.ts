import {DurableObject} from 'cloudflare:workers';
import {ScreenConflictError,ProtocolError,parseTextUI,semanticDiff} from '@mineral/textui';
import type {ScreenSnapshot} from '@mineral/textui';
import {DurableScreenPort} from '../worker-app/screen-port.js';
import {createAnimationApp} from '../animation-demo/app.js';
import {elapsed,readAnimation,renderFrame} from '../animation-demo/animation.js';
import {systemClock} from '../animation-demo/clock.js';
import {AnimationSession} from './animation-session.js';
import {LocalFrameStream} from './frame-stream.js';
import type {TextFrame} from './frame-stream.js';

export class AnimationApplication extends DurableObject<Env> {
  private port:DurableScreenPort;
  private tail:Promise<unknown>=Promise.resolve();
  private frames=new LocalFrameStream();
  private session:AnimationSession;
  private instance=crypto.randomUUID();
  private sequence=0;
  private metrics={writes:0,frames:0,messages:0};
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    this.port=new DurableScreenPort(ctx.storage,change=>{
      this.metrics.writes++;
      for(const socket of this.sockets())this.send(socket,{type:'change',screen:change.after});
    });
    this.frames.onFrame('build',frame=>{
      this.metrics.frames++;
      for(const socket of this.sockets()){
        // Sequence high water survives hibernation via socket attachments, not SQLite writes.
        socket.serializeAttachment({screen:'build',sequence:frame.sequence});
        if(this.send(socket,{type:'frame',frame}))this.metrics.messages++;
      }
    });
    this.session=new AnimationSession(systemClock,()=>this.enqueue(()=>this.pump()),error=>console.error(JSON.stringify({event:'frame-error',error:String(error)})));
    for(const socket of this.sockets())this.sequence=Math.max(this.sequence,(socket.deserializeAttachment() as {sequence?:number})?.sequence??0);
    // Existing sockets resume demand after eviction without relying on a lost React root.
    ctx.blockConcurrencyWhile(async()=>{
      const screen=await this.port.getScreen('build');
      this.session.refresh(!!screen && readAnimation(screen.text).status==='running' && this.sockets().length>0);
    });
  }
  private sockets(){return this.ctx.getWebSockets('build').filter(socket=>socket.readyState===WebSocket.OPEN);}
  private send(socket:WebSocket,value:unknown){try{socket.send(JSON.stringify(value));return true;}catch{socket.close(1011,'Send failed');return false;}}
  private enqueue<T>(work:()=>Promise<T>):Promise<T>{const result=this.tail.then(work);this.tail=result.then(()=>{},()=>{});return result;}
  private async withApp<T>(work:(app:Awaited<ReturnType<typeof createAnimationApp>>)=>Promise<T>):Promise<T>{
    const app=await createAnimationApp(this.port,systemClock,{stream:true});
    try{return await work(app);}finally{await app.close();}
  }
  private async reconcile(){
    let screen=(await this.port.getScreen('build'))!;
    let state=readAnimation(screen.text);
    if(state.status==='running' && elapsed(state,Date.now())>=state.durationMs){
      await this.withApp(app=>app.tick());screen=(await this.port.getScreen('build'))!;state=readAnimation(screen.text);
    }
    const alarm=await this.ctx.storage.getAlarm();
    if(state.status==='running'){
      const deadline=state.startedAt+state.durationMs-state.elapsedBeforePauseMs;
      if(alarm!==deadline)await this.ctx.storage.setAlarm(deadline);
    }else if(alarm!==null)await this.ctx.storage.deleteAlarm();
    this.session.refresh(state.status==='running' && this.sockets().length>0);
    return screen;
  }
  private async publish(screen:ScreenSnapshot){
    const state=readAnimation(screen.text);
    if(state.status!=='running' || !this.sockets().length)return;
    this.sequence=Math.max(this.sequence+1,Date.now());
    const frame:TextFrame={screenId:'build',targetId:'progress',animationId:state.id,sequence:this.sequence,baseRevision:screen.revision,generatedAt:Date.now(),markdown:renderFrame(state,Date.now())};
    await this.frames.publishFrame(frame);
  }
  private async pump(){const screen=await this.reconcile();await this.publish(screen);}
  /** Drain transient timers before planned hibernation; durable state and Alarm remain intact. */
  suspendFrameDelivery(){return this.enqueue(async()=>{this.session.close();});}
  override alarm(){return this.enqueue(async()=>{await this.reconcile();});}
  override fetch(request:Request){return this.enqueue(()=>this.handle(request));}
  private async handle(request:Request):Promise<Response>{
    const suffix=new URL(request.url).pathname.replace(/^\/apps\/[^/]+\/screens\/build/,'');
    if(!['','/subscribe'].includes(suffix))return new Response('Not found',{status:404});
    if(suffix==='/subscribe' && (request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket'))return new Response('WebSocket required',{status:426});
    if(suffix==='' && !['GET','PUT'].includes(request.method))return new Response('Method not allowed',{status:405});
    try{
      await this.withApp(async app=>{
        if(request.method==='PUT'){
          const body:unknown=await request.json();
          if(!body || typeof body!=='object' || !('text' in body) || typeof body.text!=='string' || !('expectedRevision' in body) || typeof body.expectedRevision!=='string')throw new ProtocolError('text and expectedRevision required');
          const before=(await this.port.getScreen('build'))!,original=parseTextUI(before.text),next=parseTextUI(body.text);
          semanticDiff(original,next,{},undefined);
          if(next.controls.size!==original.controls.size || next.blocks.size!==original.blocks.size || [...original.controls].some(([id,c])=>next.controls.get(id)?.type!==c.type) || [...original.blocks].some(([id,b])=>next.blocks.get(id)?.type!==b.type || next.blocks.get(id)?.lang!==b.lang))throw new ProtocolError('Control schema changed');
          try{readAnimation(body.text);}catch{throw new ProtocolError('Invalid animation Block');}
          await this.port.setScreen('build',body.text,{expectedRevision:body.expectedRevision,origin:'http'});
          await app.idle();
        }
        await app.tick();
      });
      const screen=await this.reconcile();
      if(suffix==='/subscribe'){
        const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1],['build']);pair[1].serializeAttachment({screen:'build',sequence:this.sequence});
        this.send(pair[1],{type:'snapshot',screen,instance:this.instance});
        await this.publish(screen);this.session.refresh(readAnimation(screen.text).status==='running');
        return new Response(null,{status:101,webSocket:pair[0]});
      }
      await this.publish(screen);
      return Response.json({screen,instance:this.instance,metrics:this.metrics,scheduled:this.session.scheduled,subscribers:this.sockets().length});
    }catch(error){
      if(error instanceof ScreenConflictError)return Response.json({error:error.name,actualRevision:error.actualRevision},{status:409});
      if(error instanceof SyntaxError || error instanceof ProtocolError)return Response.json({error:error.message},{status:400});
      throw error;
    }
  }
  override webSocketMessage(socket:WebSocket,message:string|ArrayBuffer){return this.enqueue(async()=>{
    if(message!=='snapshot'){this.send(socket,{error:'Send snapshot to resync'});return;}
    const screen=await this.reconcile();this.send(socket,{type:'snapshot',screen,instance:this.instance});await this.publish(screen);
  });}
  override webSocketClose(socket:WebSocket,code:number,reason:string){socket.close(code===1005 || code===1006?1000:code,reason);return this.enqueue(async()=>{await this.reconcile();});}
  override webSocketError(socket:WebSocket){socket.close(1011,'Socket error');return this.enqueue(async()=>{await this.reconcile();});}
}
export default {async fetch(request:Request,env:Env){
  const match=/^\/apps\/([a-zA-Z0-9_-]{1,64})\/screens\/build(?:\/subscribe)?$/.exec(new URL(request.url).pathname);
  return match?env.ANIMATION_APPS.getByName(match[1]).fetch(request):new Response('Use /apps/demo/screens/build',{status:404});
}} satisfies ExportedHandler<Env>;
