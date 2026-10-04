import {BlockTypeRegistry, parseTextUI} from '@mineral/textui';
export interface AnimationState {
  id:string;
  status:'idle'|'running'|'paused'|'completed';
  startedAt:number;
  durationMs:number;
  elapsedBeforePauseMs:number;
}
export function initialState(id='initial', durationMs=10_000):AnimationState {
  return {id,status:'idle',startedAt:0,durationMs,elapsedBeforePauseMs:0};
}
export function elapsed(state:AnimationState, now:number):number {
  return Math.min(state.durationMs, Math.max(0, state.status==='completed' ? state.durationMs : state.elapsedBeforePauseMs + (state.status==='running' ? Math.max(0,now-state.startedAt) : 0)));
}
export function progress(state:AnimationState, now:number):number {return Math.floor(elapsed(state,now)/state.durationMs*100);}
export function renderFrame(state:AnimationState, now:number):string {
  const percent=progress(state,now), filled=Math.floor(percent/10);
  const spinner=state.status==='running' && percent<100 ? ['◐','◓','◑','◒'][Math.floor(elapsed(state,now)/250)%4] : '●';
  return `${spinner} [${'='.repeat(filled)}${'.'.repeat(10-filled)}] ${percent}%`;
}
export function transition(state:AnimationState, action:'start'|'pause'|'reset'|'complete', now:number, newId:string):AnimationState {
  if(action==='reset')return initialState(newId,state.durationMs);
  if(action==='complete')return state.status==='running' && elapsed(state,now)>=state.durationMs ? {...state,status:'completed',elapsedBeforePauseMs:state.durationMs} : state;
  if(action==='pause')return state.status==='running' ? {...state,id:newId,status:elapsed(state,now)>=state.durationMs?'completed':'paused',elapsedBeforePauseMs:elapsed(state,now)} : state;
  if(state.status==='running')return state;
  return {...state,id:newId,status:'running',startedAt:now,elapsedBeforePauseMs:state.status==='paused'?state.elapsedBeforePauseMs:0};
}
export function parseAnimation(text:string):AnimationState {
  const value:unknown=JSON.parse(text);
  if(!value || typeof value!=='object')throw new Error('Invalid animation state');
  const s=value as AnimationState;
  if(typeof s.id!=='string' || !s.id || !['idle','running','paused','completed'].includes(s.status) || !Number.isFinite(s.startedAt) || s.startedAt<0 || !Number.isFinite(s.durationMs) || s.durationMs<=0 || !Number.isFinite(s.elapsedBeforePauseMs) || s.elapsedBeforePauseMs<0 || s.elapsedBeforePauseMs>s.durationMs)throw new Error('Invalid animation state');
  return {id:s.id,status:s.status,startedAt:s.startedAt,durationMs:s.durationMs,elapsedBeforePauseMs:s.elapsedBeforePauseMs};
}
export function animationTypes() {
  const types=new BlockTypeRegistry();
  types.register<AnimationState>('animation',{parse:parseAnimation,serialize:state=>JSON.stringify(parseAnimation(JSON.stringify(state)))});
  return types;
}
export function readAnimation(text:string):AnimationState {
  const block=parseTextUI(text).blocks.get('animation');
  if(block?.type!=='animation')throw new Error('Animation Block missing');
  return parseAnimation(block.value);
}
