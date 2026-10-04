import {parseTextUI} from '@mineral/textui';
import type {ScreenSnapshot} from '@mineral/textui';
import {readAnimation} from '../animation-demo/animation.js';
import type {AnimationState} from '../animation-demo/animation.js';
export interface TextFrame {screenId:string;targetId:string;animationId:string;sequence:number;baseRevision:string;generatedAt:number;markdown:string}
export interface FrameStream {
  publishFrame(frame:TextFrame):void|Promise<void>;
  onFrame(screenId:string,listener:(frame:TextFrame)=>void):(()=>void)|Promise<()=>void>;
}
/** Optional application transport; no ScreenPort reference and no retained frame history. */
export class LocalFrameStream implements FrameStream {
  private listeners=new Map<string,Set<(frame:TextFrame)=>void>>();
  publishFrame(frame:TextFrame){for(const listener of this.listeners.get(frame.screenId)??[])listener(frame);}
  onFrame(id:string,listener:(frame:TextFrame)=>void){const set=this.listeners.get(id)??new Set();this.listeners.set(id,set);set.add(listener);return ()=>{set.delete(listener);if(!set.size)this.listeners.delete(id);};}
}
/** Conservative client policy: resync on revision mismatch, never write overlays back. */
export class FrameReceiver {
  private last=-1;
  private identity='';
  accept(frame:TextFrame,snapshot:ScreenSnapshot,now:number):boolean {
    let state:AnimationState;
    try{state=readAnimation(snapshot.text);}catch{return false;}
    const target=parseTextUI(snapshot.text).controls.get(frame.targetId);
    if(frame.screenId!==snapshot.id || frame.targetId!=='progress' || target?.type!=='output' || frame.animationId!==state.id || state.status!=='running' || frame.baseRevision!==snapshot.revision || !Number.isSafeInteger(frame.sequence) || frame.sequence<0 || !Number.isFinite(frame.generatedAt) || now-frame.generatedAt>2000 || frame.generatedAt>now+250)return false;
    const identity=`${snapshot.id}:${state.id}`;
    if(identity!==this.identity){this.identity=identity;this.last=-1;}
    if(frame.sequence<=this.last)return false;
    this.last=frame.sequence;return true;
  }
}
