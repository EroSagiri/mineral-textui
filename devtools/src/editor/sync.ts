import {ScreenConflictError} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot} from '@mineral/textui';
import {mergeText} from './merge.ts';

export type SaveStatus='Saved'|'Modified'|'Saving'|'Conflict'|'Disconnected';
export interface SyncInfo {
  status:SaveStatus; base:ScreenSnapshot|null; remote:ScreenSnapshot|null; localText:string;
  error:string; saves:number; conflicts:number; composing:boolean;
}
export class EditorSync {
  readonly info:SyncInfo={status:'Disconnected',base:null,remote:null,localText:'',error:'',saves:0,conflicts:0,composing:false};
  private timer:ReturnType<typeof setTimeout>|undefined;
  private tail:Promise<unknown>=Promise.resolve();
  private unsubscribe?:()=>void;
  private closed=false;
  private stopping=false;
  private blocked=false;
  private pendingRemote:ScreenSnapshot|null=null;
  constructor(readonly port:ScreenPort,readonly id:string,private apply:(text:string)=>void,private notify:(info:SyncInfo)=>void,private log:(event:string)=>void,public debounceMs=500){}
  private emit(){this.notify({...this.info});}
  private serial<T>(job:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(()=>{if(this.closed)throw new Error('Session closed');return job();});
    this.tail=result.catch(()=>{});return result;
  }
  private cancel(){clearTimeout(this.timer);this.timer=undefined;}
  get dirty(){return this.info.localText!==this.info.base?.text;}
  async start(){
    // Notifications trigger serialized fresh reads, rather than ordering opaque revisions.
    this.unsubscribe=await this.port.onScreenChange(this.id,()=>{void this.refresh();});
    await this.refresh();
  }
  edit(text:string){
    this.info.localText=text;
    if(!this.blocked && this.info.status!=='Saving' && this.info.status!=='Conflict')this.info.status=this.dirty?'Modified':'Saved';
    this.log('本地输入');this.emit();this.schedule();
  }
  composition(active:boolean){
    this.info.composing=active;
    if(active)this.cancel();
    else {const pending=this.pendingRemote;this.pendingRemote=null;if(pending)this.receive(pending);this.schedule();}
    this.emit();
  }
  private schedule(){
    this.cancel();
    if(!this.closed && !this.stopping && !this.blocked && this.dirty && this.info.base && !this.info.composing && this.info.status!=='Conflict')this.timer=setTimeout(()=>{void this.save();},this.debounceMs);
  }
  private fail(error:unknown){
    this.blocked=true;this.cancel();this.info.status='Disconnected';
    this.info.error=error instanceof Error?error.message:String(error);this.log(`失败：${this.info.error}`);this.emit();
  }
  private receive(snapshot:ScreenSnapshot){
    if(snapshot.id!==this.id)return;
    this.info.remote=snapshot;
    if(this.info.composing){this.pendingRemote=snapshot;this.emit();return;}
    if(!this.info.base){this.info.base=snapshot;this.info.localText=snapshot.text;this.apply(snapshot.text);}
    else if(this.info.status==='Conflict'){this.emit();return;}
    else {
      const merged=mergeText(this.info.base.text,this.info.localText,snapshot.text);
      if(merged.conflict){this.cancel();this.info.status='Conflict';this.info.conflicts++;this.log('冲突：保留本地输入，暂停自动保存');this.emit();return;}
      this.info.base=snapshot;
      if(this.info.localText!==merged.text){this.info.localText=merged.text;this.apply(merged.text);}
    }
    this.blocked=false;this.info.error='';this.info.status=this.dirty?'Modified':'Saved';this.log('确认远程快照');this.emit();this.schedule();
  }
  async refresh(){
    return this.serial(async()=>{
      try {const snapshot=await this.port.getScreen(this.id);if(!snapshot)throw new Error('Screen 不存在');this.receive(snapshot);}
      catch(error){this.fail(error);}
    });
  }
  async save(){
    this.cancel();
    return this.serial(async()=>{
      if(!this.info.base || !this.dirty || this.info.composing || this.info.status==='Conflict' || this.blocked)return;
      const submitted=this.info.localText,base=this.info.base;
      this.info.status='Saving';this.emit();
      try {
        const saved=await this.port.setScreen(this.id,submitted,{expectedRevision:base.revision,origin:'devtools'});
        this.info.saves++;this.log('保存成功');
        // Inputs arriving during this request are relative to submitted, never old base.
        this.info.base={...saved,text:submitted};
        this.receive(saved);
      } catch(error){
        if(error instanceof ScreenConflictError){
          try {const latest=await this.port.getScreen(this.id);if(!latest)throw new Error('Screen 已删除');this.receive(latest);}
          catch(readError){this.fail(readError);}
        } else this.fail(error);
      }
    });
  }
  async flush():Promise<boolean>{
    if(this.info.composing || this.info.status==='Conflict' || this.blocked)return false;
    // Drain edits arriving while an earlier save was pending.
    await this.save();await this.tail;
    if(this.dirty && !this.blocked && !this.info.composing)await this.save();
    return !this.dirty && this.info.status==='Saved';
  }
  async retry(){this.blocked=false;await this.refresh();await this.save();}
  async resolve(choice:'local'|'remote'|'manual',manual?:string){
    if(this.info.composing)return;
    await this.refresh();
    const remote=this.info.remote;if(!remote || this.blocked)return;
    this.info.base=remote;
    const text=choice==='remote'?remote.text:choice==='manual'?(manual??this.info.localText):this.info.localText;
    this.info.localText=text;this.apply(text);this.info.status=this.dirty?'Modified':'Saved';this.emit();this.schedule();
  }
  disconnect(){this.fail(new Error('连接断开；本地输入已保留'));}
  async close(){this.stopping=true;this.cancel();this.unsubscribe?.();await this.tail;this.closed=true;}
}
