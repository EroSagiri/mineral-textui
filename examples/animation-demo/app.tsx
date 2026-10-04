import {ScreenConflictError,parseTextUI} from '@mineral/textui';
import type {ScreenPort} from '@mineral/textui';
import {Screen,Heading,Text,Output,Input,Block,Action,useTextState,render} from '@mineral/textui-react';
import {animationTypes,initialState,parseAnimation,progress,transition} from './animation.js';
import type {Clock} from './clock.js';

function Monitor({clock,now,stream,durationMs,newId}:{clock:Clock;now:number;stream:boolean;durationMs:number;newId:()=>string}) {
  const [content,setContent]=useTextState('animation',JSON.stringify(initialState('initial',durationMs)));
  const [note]=useTextState('note','Edit while running');
  const state=parseAnimation(content);
  const change=(action:'start'|'pause'|'reset')=>setContent(JSON.stringify(transition(parseAnimation(content),action,clock.now(),newId())));
  // In stream mode only meaningful state transitions alter persistent output.
  const percent=progress(state,stream && state.status==='running'?state.startedAt:now);
  return <Screen id="build"><Heading>Build Monitor</Heading>
    <Output id="progress" label="Progress" value={`${percent}% [${'='.repeat(Math.floor(percent/10))}${'.'.repeat(10-Math.floor(percent/10))}]`}/>
    <Output id="status" label="Status" value={state.status}/>
    <Input id="note" label="Note" value={note}/>
    <Action id="start" label="Start / Resume" onTrigger={()=>change('start')}/>
    <Action id="pause" label="Pause" onTrigger={()=>change('pause')}/>
    <Action id="reset" label="Reset" onTrigger={()=>change('reset')}/>
    <Block id="animation" type="animation" lang="json" value={content}/>
    <Text>Animation state is persisted in the Block. Temporary frames require a subscription.</Text>
  </Screen>;
}
export async function createAnimationApp(host:ScreenPort,clock:Clock,options:{stream?:boolean;durationMs?:number;newId?:()=>string;onError?:(error:Error)=>void}={}) {
  const node=()=> <Monitor clock={clock} now={clock.now()} stream={options.stream??false} durationMs={options.durationMs??10_000} newId={options.newId??(()=>crypto.randomUUID())}/>;
  const errors:Error[]=[];
  const root=await render(node(),{host,screen:'build',blockTypes:animationTypes(),onError:error=>{if(!(error instanceof ScreenConflictError)){errors.push(error);options.onError?.(error);}}});
  let closed=false,cancel:(()=>void)|undefined,tail:Promise<unknown>=Promise.resolve();
  const state=()=>parseAnimation(String(root.store.read('animation')));
  const settle=async()=>{await root.idle();if(errors.length)throw errors.shift()!;};
  const tick=()=>{
    const work=tail.then(async()=>{
      if(closed)return;
      await settle();
      const before=state(),next=transition(before,'complete',clock.now(),before.id);
      const saved=await host.getScreen('build');
      const percent=progress(next,options.stream && next.status==='running'?next.startedAt:clock.now());
      const output=`${percent}% [${'='.repeat(Math.floor(percent/10))}${'.'.repeat(10-Math.floor(percent/10))}]`;
      if(next===before && saved && parseTextUI(saved.text).controls.get('progress')?.value===output)return;
      if(next!==before)root.store.set('animation',JSON.stringify(next));
      try{await root.update(node());}catch(error){
        if(!(error instanceof ScreenConflictError))throw error;
        // The runtime rereads, hydrates and patches the latest document. Never resend old text.
        await settle();await root.update(node());
      }
      await settle();
    });
    tail=work.catch(()=>{});return work;
  };
  const reschedule=()=>{
    cancel?.();cancel=undefined;
    if(!closed && state().status==='running')cancel=clock.schedule(()=>{cancel=undefined;void tick().then(reschedule).catch(error=>options.onError?.(error));},1000);
  };
  let unsubscribe:(()=>void)|undefined;
  return {
    root,state,tick,idle:settle,
    async startScheduling(){if(unsubscribe)return;unsubscribe=await host.onScreenChange('build',()=>{void settle().then(reschedule).catch(error=>options.onError?.(error));});await tick();reschedule();},
    async close(){if(closed)return;closed=true;cancel?.();unsubscribe?.();await tail;await root.unmount();},
  };
}
