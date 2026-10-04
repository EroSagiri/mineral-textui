import type {ReactNode} from 'react';
import type {ScreenPort,ScreenSnapshot,Unsubscribe} from '@mineral/textui';

export interface DevtoolsScreen {id:string;label?:string}
export interface DevtoolsScreenDiscovery {listScreens():Promise<DevtoolsScreen[]>}
export interface DevtoolsFrame {screenId:string;targetId:string;animationId:string;sequence:number;baseRevision:string;generatedAt:number;markdown:string}
export interface DevtoolsInspection {state?:unknown;tree?:unknown;router?:unknown;[key:string]:unknown}
export interface DevtoolsApp {
  update?(node:ReactNode):Promise<unknown>;
  unmount?():Promise<unknown>;
  close?():Promise<unknown>;
}
export interface DevtoolsSession {
  /** Stable application identity; drafts are additionally fenced by each bridge instance. */
  id?:string;label?:string;mode?:'sandbox'|'local'|'remote';
  port:ScreenPort;app?:DevtoolsApp;discovery?:DevtoolsScreenDiscovery;
  screens?:DevtoolsScreen[];entry?:string;preview?:string;
  inspect?():DevtoolsInspection|Promise<DevtoolsInspection>;
  subscribeFrames?(screen:string,listener:(frame:DevtoolsFrame)=>void):Promise<Unsubscribe>;
  reload?(context:DevtoolsContext):Promise<void>;
  close?():Promise<void>;
}
export interface DevtoolsContext {
  readonly projectRoot:string;
  readonly mode:'sandbox'|'local';
  /** Optional observation wrapper. The underlying storage implementation stays untouched. */
  observePort(port:ScreenPort):ScreenPort;
  loadModule(path:string):Promise<Record<string,any>>;
}
export interface DevtoolsConfiguration {
  mode?:'sandbox'|'local';
  createSession?(context:DevtoolsContext):Promise<DevtoolsSession>|DevtoolsSession;
  /** Connect to an existing development Bridge; never instantiate its Host in Node. */
  remote?:{url:string;token?:string};
  /** Browser-only preview entry; createSession is never sent to the browser. */
  preview?:string;
}
export function defineDevtools(configuration:DevtoolsConfiguration):DevtoolsConfiguration {return configuration;}

export interface DevtoolsObservation {known:Set<string>;events:{time:number;kind:string;screen:string;detail?:unknown}[]}
export function observeScreenPort(port:ScreenPort,observation:DevtoolsObservation):ScreenPort {
  const record=(kind:string,id:string,detail?:unknown)=>{
    observation.known.add(id);observation.events.push({time:Date.now(),kind,screen:id,detail});
    if(observation.events.length>200)observation.events.splice(0,observation.events.length-200);
  };
  return {
    async getScreen(id){record('read',id);return port.getScreen(id);},
    async setScreen(id,text,options){
      try{const snapshot=await port.setScreen(id,text,options);record('write',id,{revision:snapshot.revision,origin:options.origin});return snapshot;}
      catch(error){record('write-error',id,String(error));throw error;}
    },
    async onScreenChange(id,listener){record('subscribe',id);return port.onScreenChange(id,change=>{
      record('change',id,{revision:change.after.revision,origin:change.origin});listener(change);
    });},
  };
}
/** Only Screen snapshots are cloned. Applications must mock their external side effects. */
export async function cloneScreens(source:ScreenPort,target:ScreenPort,ids:readonly string[]):Promise<ScreenSnapshot[]> {
  const snapshots:ScreenSnapshot[]=[];
  for(const id of ids){const snapshot=await source.getScreen(id);if(snapshot)snapshots.push(await target.setScreen(id,snapshot.text,{expectedRevision:null,origin:'devtools-sandbox'}));}
  return snapshots;
}
