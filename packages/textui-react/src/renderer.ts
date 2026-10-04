import {createElement} from 'react';
import type {ReactNode} from 'react';
import {TextUIStore,ScreenSession,ScreenConflictError,parseTextUI,serializeTree,patchTree,patchValues,semanticDiff,ProtocolError,blockTypes,parseNumberText,validateField,FieldValidationException} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,ParsedScreen,SerializedTree,RegisteredControl,RegisteredBlock,UIEvent,ElementNode,BlockTypeRegistry,ValidationOptions,StateValue} from '@mineral/textui';
import {reconciler} from './reconciler.js';
import type {Container} from './host-config.js';
import {StoreContext} from './hooks.js';

export interface RenderOptions {screen:string; host:ScreenPort; onError?:(error:Error)=>void; blockTypes?:BlockTypeRegistry}
/** Called once with the subscribed, current snapshot; no routing semantics. */
export type AppInitializer = (snapshot:ScreenSnapshot|null)=>ReactNode;
export interface RunningRoot {
  readonly store:TextUIStore;
  update(app:ReactNode):Promise<void>;
  flush():Promise<void>;
  idle():Promise<void>;
  unmount():Promise<void>;
  getTree():ElementNode;
}

/** Commits maintain memory; all Screen IO runs through an injected port in a serialized lane. */
export async function render(app:ReactNode|AppInitializer,options:RenderOptions):Promise<RunningRoot> {
  const store=new TextUIStore();
  const types=options.blockTypes??blockTypes;
  const parse=(text:string)=>{const parsed=parseTextUI(text);for(const b of parsed.blocks.values())types.get(b.type)?.parse(b.value);return parsed;};
  let document:ParsedScreen, previous:SerializedTree|undefined;
  let active=true,ready=false,processing=false,queued=false,blocked=false;
  let rootError:Error|undefined,closing:Promise<void>|undefined;
  const accepted=new Set<string>();
  const report=(error:unknown)=>{
    const value=error instanceof Error?error:new Error(String(error));
    if(options.onError)options.onError(value);else console.error(`TextUI：${value.message}`);
  };
  const session=new ScreenSession(options.host,options.screen,report);
  const getTree=():ElementNode=>{
    let screens=0;
    const visit=(node:ElementNode)=>{if(node.type==='screen' && ++screens>1)throw new ProtocolError('一个应用 Root 只能包含一个 Screen；页面切换请在应用层实现。');for(const child of node.children)if(child.kind==='element' && !child.hidden)visit(child);};
    for(const node of container.children)if(node.kind==='element' && !node.hidden)visit(node);
    return {kind:'element',type:'screen',props:{},children:container.children};
  };
  const container:Container={children:[],commit:()=>{
    if(!ready || !active || processing || queued || blocked)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      if(active && !processing && !blocked)void flush().catch(error=>{blocked=true;report(error);});
    });
  }};
  const catchRoot=(error:Error)=>{rootError=error;if(ready)report(error);};
  const root=reconciler.createContainer(container,1,null,false,null,'',catchRoot,catchRoot,catchRoot,()=>{},null);
  const wrap=(node:ReactNode)=>createElement(StoreContext.Provider,{value:store},node);
  function syncReact() {
    reconciler.flushSyncWork();reconciler.flushPassiveEffects();reconciler.flushSyncWork();
    if(rootError)throw rootError;
  }
  function stateKey(c:RegisteredControl|RegisteredBlock){return c.stateKey ?? (store.read(c.id)!==undefined?c.id:undefined);}
  function validateBindings(tree:SerializedTree) {
    const bound=new Set([...tree.registry.values()].filter(c=>c.type!=='action').map(stateKey).concat([...tree.blocks.values()].map(stateKey)));
    for(const key of store.snapshot().keys())if(!bound.has(key))throw new ProtocolError(`持久状态 ${key} 未绑定控件，请声明 stateKey。`);
  }
  function validateFields(tree:SerializedTree,source:ParsedScreen,initial:boolean) {
    for(const [id,c] of [...tree.registry,...tree.blocks] as [string,RegisteredControl|RegisteredBlock][]) {
      const saved=source.controls.get(id)??source.blocks.get(id);
      if(!saved)continue;
      const old=document?.controls.get(id)??document?.blocks.get(id);
      if(!initial && old?.value===saved.value)continue;
      if(c.type!=='input' && c.type!=='number' && c.type!=='textarea')continue;
      let value:string|number|null=String(saved.value);
      if(c.type==='number')try{value=parseNumberText(String(saved.value));}catch(error){throw new FieldValidationException(id,'parse',String((error as Error).message),saved.start,saved.end);}
      let result;
      try{result=validateField(value,c.props as ValidationOptions<string|number|null>,'edit');}catch(error){throw new FieldValidationException(id,'validator',error instanceof Error?error.message:String(error),saved.start,saved.end);}
      if(!result.valid)throw new FieldValidationException(id,'validation',result.message??'字段校验失败。',saved.start,saved.end);
    }
  }
  function hydrate(tree:SerializedTree,source:ParsedScreen,initial:boolean) {
    const restored=new Map<string,StateValue>(),numericKeys=new Set<string>();
    for(const [id,c] of tree.registry) {
      const saved=source.controls.get(id);
      if(!saved || saved.type!==c.type || saved.group!==c.group)throw new ProtocolError(`持久控件缺失或协议改变：${id}`);
      const key=stateKey(c);
      if(!key || c.type==='action' || (!initial && c.type==='output'))continue;
      if(c.type==='select' && !saved.value)continue;
      const value=c.type==='number'?parseNumberText(String(saved.value)):c.type==='select'?c.optionValue!:saved.value;
      if(c.type==='number')numericKeys.add(key);
      if(restored.has(key) && restored.get(key)!==value)throw new ProtocolError(`状态键 ${key} 绑定了互相冲突的控件。`);
      restored.set(key,value);
    }
    const validation=new TextUIStore();
    for(const [id,b] of tree.blocks) {
      const saved=source.blocks.get(id);
      if(!saved || saved.type!==b.type || saved.lang!==b.lang)throw new ProtocolError(`持久 Block 缺失或协议改变：${id}`);
      const key=stateKey(b);
      if(key){if(restored.has(key)&&restored.get(key)!==saved.value)throw new ProtocolError(`状态键 ${key} 绑定了互相冲突的控件。`);restored.set(key,saved.value);}
    }
    for(const [key,value] of store.snapshot())validation.set(key,value);
    for(const [key,value] of restored)if(numericKeys.has(key))validation.set(key,value);else validation.restore(key,value);
    for(const [key,value] of validation.snapshot())store.set(key,value);
  }
  async function write(next:SerializedTree,source:ScreenSnapshot|null,parsed?:ParsedScreen) {
    validateBindings(next);
    const text=source?patchTree(parsed??parse(source.text),previous,next):next.text;
    parse(text);
    const after=await session.commit(source,text);document=parse(after.text);previous=next;
  }
  function flush():Promise<void> {
    return session.run(async()=>{
      if(!active || !ready)return;
      if(blocked)throw new ProtocolError('文档事务尚未确认；修复屏幕并保存后再更新。');
      syncReact();
      const source=await options.host.getScreen(options.screen);
      if(!source || source.revision!==session.snapshot?.revision) {
        session.refresh();
        throw new ScreenConflictError(options.screen,session.snapshot?.revision??null,source?.revision??null);
      }
      await write(serializeTree(getTree()),source);
    });
  }
  function dispatch(event:UIEvent,tree:SerializedTree) {
    const registry=tree.registry;
    const c=event.type==='textChange'||event.type==='blockEvent'?tree.blocks.get(event.target):registry.get(event.target);
    if(!c)throw new ProtocolError(`未注册的事件目标：${event.target}`);
    if(c.type==='number' && event.type==='change'){const handler=c.props.onValueChange;if(typeof handler==='function'){const result:unknown=handler(parseNumberText(String(event.after)));if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(report);throw new ProtocolError('事件处理器必须同步完成，不能返回 Promise。');}}return;}
    const handler=c.props[c.type==='textarea'&&event.type==='textChange'?'onChange':event.type==='change'?'onChange':event.type==='select'?'onSelect':event.type==='textChange'?'onTextChange':event.type==='blockEvent'?'onEvent':'onTrigger'];
    if(event.type==='select')event={...event,after:event.after===null?null:(c as RegisteredControl).optionValue!,before:event.before?registry.get(event.before)?.optionValue??null:null};
    if(typeof handler==='function') {
      const result:unknown=handler(event);
      if(result && typeof(result as {then?:unknown}).then==='function') {
        void Promise.resolve(result).catch(report);throw new ProtocolError('事件处理器必须同步完成，不能返回 Promise。');
      }
    }
  }
  async function processScreen(snapshot:ScreenSnapshot) {
    if(!active)return;
    processing=true;
    const backup=store.snapshot(),oldPrevious=previous;
    try {
      let source=parse(snapshot.text);
      const events=semanticDiff(document,source,{},types);
      blocked=false;
      if(accepted.has(snapshot.text)) {
        const confirmed=previous;
        previous=undefined;
        try{await write(serializeTree(getTree()),snapshot,source);}catch(error){previous=confirmed;throw error;}
        return;
      }
      const normalized=new Map<string,string|boolean>();
      for(const event of events)if(event.type==='select')for(const c of source.controls.values())if(c.type==='select' && c.group===event.group)normalized.set(c.id,c.id===event.after);
      source=parse(patchValues(source,normalized));
      validateFields(previous!,source,false);
      hydrate(previous!,source,false);
      reconciler.flushSyncFromReconciler(()=>{});syncReact();
      const rendered=serializeTree(getTree()),registry=rendered.registry;
      for(const event of events){const c=rendered.registry.get(event.target)??rendered.blocks.get(event.target);
        if(c?.props.disabled||c?.props.readOnly)throw new FieldValidationException(event.target,c.props.disabled?'disabled':'readOnly','当前应用状态不允许此操作。');}

      reconciler.flushSyncFromReconciler(()=>{for(const event of events)dispatch(event,rendered);});syncReact();
      previous={...previous!,registry:new Map([...previous!.registry].map(([id,c])=>[id,{...c,value:source.controls.get(id)?.value??c.value}])),blocks:new Map([...previous!.blocks].map(([id,b])=>[id,{...b,value:source.blocks.get(id)?.value??b.value}]))};
      const next=serializeTree(getTree());
      for(const c of source.controls.values())if(c.type==='output' && registry.has(c.id) && c.value!==document.controls.get(c.id)?.value)report(new ProtocolError(`只读输出被修改，恢复应用值：${c.id}`));
      await write(next,snapshot,source);
      if(events.some(e=>e.type==='trigger')) {accepted.add(snapshot.text);if(accepted.size>128)accepted.delete(accepted.values().next().value!);}
    } catch(error) {blocked=true;store.rollback(backup);previous=oldPrevious;report(error);}
    finally{processing=false;}
  }
  try {
    await session.start(async snapshot=>{
      reconciler.updateContainerSync(wrap(typeof app==='function'?app(snapshot):app),root,null,null);syncReact();
      let tree=serializeTree(getTree());validateBindings(tree);
      if(snapshot) {
        document=parse(snapshot.text);semanticDiff(document,document,{},types);
        processing=true;validateFields(tree,document,true);hydrate(tree,document,true);reconciler.flushSyncFromReconciler(()=>{});syncReact();processing=false;
        tree=serializeTree(getTree());
      }
      await write(tree,snapshot);
      ready=true;
    },processScreen);
  } catch(error) {
    active=false;
    reconciler.updateContainerSync(null,root,null,null);reconciler.flushSyncWork();reconciler.flushPassiveEffects();
    store.clear();await session.close();throw error;
  }
  return {
    store,getTree,flush,idle:()=>session.idle(),
    async update(node) {
      if(!active)throw new Error('React Root 已卸载。');
      reconciler.updateContainerSync(wrap(node),root,null,null);await flush();
    },
    unmount() {
      return closing ??= (async()=>{
        try{if(!blocked)await flush();}
        finally {
          active=false;
          try{reconciler.updateContainerSync(null,root,null,null);syncReact();}
          finally{store.clear();await session.close();}
        }
      })();
    },
  };
}
