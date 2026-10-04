import {parseTextUI} from '@mineral/textui';
import type {ScreenSnapshot} from '@mineral/textui';
import type {DevtoolsFrame} from '../api.js';
/** Transient output overlays never write Screen text or change revisions. */
export class FrameClient {
  private sequences=new Map<string,number>();
  private animations=new Map<string,{id:string;generatedAt:number;retired:Set<string>}>();
  received=0;dropped=0;
  accept(frame:DevtoolsFrame,snapshot:ScreenSnapshot|null,now=Date.now()):boolean{
    this.received++;
    try{
      if(!snapshot || frame.screenId!==snapshot.id || frame.baseRevision!==snapshot.revision || !Number.isSafeInteger(frame.sequence) || frame.sequence<0 || !Number.isFinite(frame.generatedAt) || now-frame.generatedAt>2000 || frame.generatedAt>now+1000 || typeof frame.markdown!=='string')throw new Error('Stale frame');
      const target=parseTextUI(snapshot.text).controls.get(frame.targetId);
      if(target?.type!=='output')throw new Error('Output target required');
      const outputKey=JSON.stringify([snapshot.id,snapshot.revision,frame.targetId]);
      let animation=this.animations.get(outputKey);
      if(animation && animation.id!==frame.animationId){
        if(animation.retired.has(frame.animationId) || frame.generatedAt<animation.generatedAt)throw new Error('Retired animation');
        animation.retired.add(animation.id);if(animation.retired.size>100)animation.retired.delete(animation.retired.values().next().value!);
        animation={...animation,id:frame.animationId,generatedAt:frame.generatedAt};
      }
      const key=JSON.stringify([snapshot.id,snapshot.revision,frame.targetId,frame.animationId]);
      if(frame.sequence<=(this.sequences.get(key)??-1))throw new Error('Duplicate frame');
      this.animations.set(outputKey,animation?{...animation,generatedAt:Math.max(animation.generatedAt,frame.generatedAt)}:{id:frame.animationId,generatedAt:frame.generatedAt,retired:new Set()});
      if(this.animations.size>1000)this.animations.delete(this.animations.keys().next().value!);
      this.sequences.set(key,frame.sequence);if(this.sequences.size>1000)this.sequences.delete(this.sequences.keys().next().value!);
      return true;
    }catch{this.dropped++;return false;}
  }
}
