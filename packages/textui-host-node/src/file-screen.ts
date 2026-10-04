import {readFileSync,writeFileSync,renameSync,rmSync,mkdirSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FSWatcher} from 'chokidar';
import {ScreenConflictError,assertRevision,absentSnapshot} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,ScreenChange,ScreenWriteOptions,Unsubscribe} from '@mineral/textui';
import {watchFile} from './watcher.js';

interface FileState {
  snapshot:ScreenSnapshot|null;
  listeners:Set<(change:ScreenChange)=>void>;
  watcher?:FSWatcher;
  starting?:Promise<FSWatcher>;
}
export interface NodeHost extends ScreenPort {close():Promise<void>; filePath(id:string):string}
export interface NodeHostOptions {onError?:(error:unknown)=>void}
/** Limited conflict detection against editors that do not share an atomic compare-and-set. */
class FileHost implements NodeHost {
  private states=new Map<string,FileState>();
  private closures=new Set<Promise<void>>();
  private closed=false;
  readonly root:string;
  constructor(directory:string, private options:NodeHostOptions) {mkdirSync(directory,{recursive:true});this.root=realpathSync(resolve(directory));}
  private report=(error:unknown)=>{if(this.options.onError)this.options.onError(error);else console.error(error);};
  filePath(id:string):string {
    if (!id || id==='.' || id==='..' || /[<>:"/\\|?*\x00-\x1f]/.test(id) || /[. ]$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) throw new Error(`无效文件屏幕 ID：${id}`);
    return resolve(this.root,`${id}.md`);
  }
  private state(id:string):FileState {
    if(this.closed) throw new Error('Node Host 已关闭。');
    const key=process.platform==='win32'?id.toLowerCase():id;
    let state=this.states.get(key);
    if(!state) {state={snapshot:null,listeners:new Set()};this.states.set(key,state);}
    return state;
  }
  private text(id:string):string|null {
    const file=this.filePath(id);
    try {
      const actual=realpathSync(file), rel=relative(this.root,actual);
      if(rel.startsWith('..') || isAbsolute(rel)) throw new Error('屏幕文件指向 Host 目录以外。');
      return readFileSync(file,'utf8');
    } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') return null; throw error;}
  }
  private notify(state:FileState,change:ScreenChange):void {
    for(const listener of state.listeners) {try{listener(Object.freeze(change));}catch(error){this.report(error);}}
  }
  private refresh(id:string):ScreenSnapshot|null {
    const state=this.state(id), text=this.text(id), before=state.snapshot;
    if(text===null) {state.snapshot=null; if(before)this.report(new Error(`屏幕 ${id} 文件被删除；恢复文件后继续监听。`));return null;}
    if(before?.text===text) return before;
    const after=Object.freeze({id,text,revision:randomUUID()}); state.snapshot=after;
    this.notify(state,{before:before??absentSnapshot(id),after}); return after;
  }
  async getScreen(id:string):Promise<ScreenSnapshot|null> {return this.refresh(id);}
  async setScreen(id:string,text:string,options:ScreenWriteOptions):Promise<ScreenSnapshot> {
    const state=this.state(id), before=this.refresh(id);
    assertRevision(id,before,options);
    if(before?.text===text) return before;
    const file=this.filePath(id);
    if(!before) {
      try{writeFileSync(file,text,{encoding:'utf8',flag:'wx'});}
      catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new ScreenConflictError(id,null,this.refresh(id)?.revision??null);throw error;}
    } else {
      const target=realpathSync(file),temporary=`${target}.${randomUUID()}.textui-tmp`;
      try {
        writeFileSync(temporary,text,{encoding:'utf8',flag:'wx',mode:statSync(target).mode});
        const latest=this.refresh(id);
        assertRevision(id,latest,options);
        renameSync(temporary,target);
      } finally{rmSync(temporary,{force:true});}
    }
    const after=Object.freeze({id,text,revision:randomUUID()});state.snapshot=after;
    this.notify(state,{before:before??absentSnapshot(id),after,origin:options.origin});return after;
  }
  async onScreenChange(id:string,listener:(change:ScreenChange)=>void):Promise<Unsubscribe> {
    const state=this.state(id); this.filePath(id);
    state.listeners.add(listener);
    if(!state.starting) state.starting=watchFile(this.filePath(id),()=>{if(!this.closed){try{this.refresh(id);}catch(error){this.report(error);}}},this.report);
    try {state.watcher=await state.starting;}
    catch(error){state.listeners.delete(listener);state.starting=undefined;throw error;}
    let subscribed=true;
    return ()=>{
      if(!subscribed)return;subscribed=false;state.listeners.delete(listener);
      if(!state.listeners.size && state.watcher) {
        const close=state.watcher.close();this.closures.add(close);void close.finally(()=>this.closures.delete(close)).catch(this.report);
        state.watcher=undefined;state.starting=undefined;
      }
    };
  }
  async close():Promise<void> {
    if(this.closed)return;this.closed=true;
    const closes=[...this.closures];
    for(const state of this.states.values()) {state.listeners.clear();if(state.starting)closes.push(state.starting.then(w=>w.close()));}
    await Promise.all(closes);this.states.clear();
  }
}
export function createNodeHost(directory:string,options:NodeHostOptions={}):NodeHost {return new FileHost(directory,options);}
