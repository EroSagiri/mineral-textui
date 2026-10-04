import {ScreenConflictError} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,ScreenWriteOptions,ScreenChange} from '@mineral/textui';
import type {DevtoolsFrame as TextFrame} from '../api.js';

export class ScreenClient implements ScreenPort {
  constructor(readonly prefix:string,private connection:(connected:boolean)=>void,private frame:(frame:TextFrame)=>void,private clearFrames:()=>void,readonly sessionId?:string){}
  private headers():Record<string,string>{return this.sessionId?{'X-TextUI-Session':this.sessionId}:{};}
  private path(id:string){return `${this.prefix}/screens/${encodeURIComponent(id)}`;}
  async getScreen(id:string):Promise<ScreenSnapshot|null>{
    const response=await fetch(this.path(id),{headers:this.headers(),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`读取失败 (${response.status})`);
    return (await response.json()).screen;
  }
  async setScreen(id:string,text:string,options:ScreenWriteOptions):Promise<ScreenSnapshot>{
    const response=await fetch(this.path(id),{method:'PUT',headers:{'Content-Type':'application/json',...this.headers()},body:JSON.stringify({text,...options}),signal:AbortSignal.timeout(10000)});
    const body=await response.json();
    if(response.status===409)throw new ScreenConflictError(id,options.expectedRevision,body.actualRevision);
    if(!response.ok)throw new Error(body.error??`保存失败 (${response.status})`);
    return body.screen;
  }
  async onScreenChange(id:string,listener:(change:ScreenChange)=>void):Promise<()=>void>{
    let stopped=false, socket:WebSocket, timer:ReturnType<typeof setTimeout>|undefined;
    let first=true, readyResolve:()=>void,readyReject:(error:Error)=>void;
    const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    // The listener is only a dirty hint. EditorSync always rereads a fresh snapshot.
    const notify=()=>listener({before:{id,text:'',revision:''},after:{id,text:'',revision:''}});
    const connect=()=>{
      socket=new WebSocket(new URL(`${this.path(id)}/subscribe${this.sessionId?'?session='+encodeURIComponent(this.sessionId):''}`,location.href).href.replace(/^http/,'ws'));
      let established=false;
      const establish=()=>{if(established)return;established=true;this.connection(true);if(first){first=false;readyResolve();}else notify();};
      socket.onmessage=event=>{
        if(stopped)return;
        try {
          const value=JSON.parse(event.data);
          // The Bridge acknowledges only after the Host subscription is installed.
          if(value.type==='ready' || value.type==='snapshot')establish();
          if(value.type==='change' || value.type==='snapshot')notify();
          if(value.type==='frame')this.frame(value.frame);
        } catch {this.clearFrames();}
      };
      socket.onclose=()=>{
        if(stopped)return;
        this.clearFrames();this.connection(false);
        if(first){first=false;readyReject(new Error('无法建立订阅；请启动对应 Host'));}
        if(!stopped)timer=setTimeout(connect,1000);
      };
      socket.onerror=()=>socket.close();
    };
    connect();
    const timeout=setTimeout(()=>readyReject(new Error('订阅连接超时')),10000);
    try {await ready;}catch(error){stopped=true;clearTimeout(timer);socket!.close();throw error;}finally{clearTimeout(timeout);}
    return ()=>{stopped=true;clearTimeout(timer);socket.close();this.clearFrames();};
  }
}
