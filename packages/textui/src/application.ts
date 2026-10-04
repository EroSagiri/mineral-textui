import {parseTextUI} from './parser.js';
import {patchValues} from './patch.js';
import {semanticDiff} from './events.js';
import {ProtocolError} from './schema.js';
import type {ParsedScreen, ControlType, ControlValue, ProtocolOptions} from './schema.js';
import type {UIEvent} from './events.js';
import type {ScreenPort, ScreenSnapshot} from './screen.js';
import {ScreenSession} from './session.js';

export interface Application {
  name: string;
  initialContent: string;
  protocol?: ProtocolOptions;
  validate(document: ParsedScreen): void;
  handle(events: readonly UIEvent[], document: ParsedScreen): Readonly<Record<string,ControlValue>>;
}
export interface RunningApplication {id:string; close():Promise<void>; idle():Promise<void>}
export function requireControls(document:ParsedScreen, expected:Record<string,ControlType>):void {
  for (const [id,type] of Object.entries(expected)) if (document.controls.get(id)?.type!==type) throw new ProtocolError(`应用需要 ${type} 控件：${id}`);
}
/** Text-only applications use the same ports, parser and serialized transaction lane as React. */
export async function startApplication(application:Application, options:{host:ScreenPort; screen:string; onError:(error:Error)=>void}):Promise<RunningApplication> {
  const report=(error:unknown)=>options.onError(error instanceof Error?error:new Error(String(error)));
  const session=new ScreenSession(options.host,options.screen,report);
  const parse=(text:string)=>parseTextUI(text,application.protocol);
  let document:ParsedScreen;
  const accepted=new Set<string>();
  const commit=async(source:ScreenSnapshot|null, next:ParsedScreen, updates:ReadonlyMap<string,ControlValue>)=>{
    const after=await session.commit(source,patchValues(next,updates,application.protocol)); document=parse(after.text);
  };
  await session.start(async snapshot=>{
    document=parse(snapshot?.text ?? application.initialContent); application.validate(document);
    const selected=new Set<string>(), resets=new Map<string,ControlValue>();
    for (const c of document.controls.values()) {
      if(c.type==='action') resets.set(c.id,false);
      if(c.type==='select' && c.value) {if(selected.has(c.group!)) throw new ProtocolError(`分组 ${c.group} 存在多个选中项。`); selected.add(c.group!);}
    }
    await commit(snapshot,document,resets);
  },async snapshot=>{
    const next=parse(snapshot.text);
    if (accepted.has(next.text)) {
      const restore=new Map<string,ControlValue>();
      for(const c of next.controls.values()) {
        if(c.type==='action') restore.set(c.id,false);
        if(c.type==='output' && document.controls.get(c.id)?.type==='output') restore.set(c.id,document.controls.get(c.id)!.value);
      }
      await commit(snapshot,next,restore); return;
    }
    const events=semanticDiff(document,next,application.protocol);
    const updates=new Map<string,ControlValue>(events.length?Object.entries(application.handle(events,next)):[]);
    for(const event of events) {
      if(event.type==='trigger') updates.set(event.target,false);
      if(event.type==='select') for(const c of next.controls.values()) if(c.type==='select' && c.group===event.group) updates.set(c.id,c.id===event.after);
    }
    await commit(snapshot,next,updates);
    if(events.some(e=>e.type==='trigger')) {accepted.add(next.text); if(accepted.size>128) accepted.delete(accepted.values().next().value!);}
  });
  return {id:options.screen,close:()=>session.close(),idle:()=>session.idle()};
}
