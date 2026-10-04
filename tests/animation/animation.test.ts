import {expect,test} from 'vitest';
import {MemoryScreen,parseTextUI,patchValues} from '@mineral/textui';
import type {ScreenWriteOptions} from '@mineral/textui';
import {createNodeHost} from '@mineral/textui-host-node';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialState,elapsed,renderFrame,transition,parseAnimation} from '../../examples/animation-demo/animation.js';
import {createAnimationApp} from '../../examples/animation-demo/app.js';
import {ManualClock} from '../../examples/animation-demo/clock.js';
import {FrameReceiver,LocalFrameStream} from '../../examples/worker-animation/frame-stream.js';
import type {TextFrame} from '../../examples/worker-animation/frame-stream.js';
import {AnimationSession} from '../../examples/worker-animation/animation-session.js';

test('pure frames, clamped boundaries, pause/resume/reset and validation',()=>{
  const idle=initialState('a',1000),running=transition(idle,'start',100,'b');
  expect(renderFrame(running,600)).toBe(renderFrame({...running},600));
  expect(renderFrame(running,0)).toContain('0%');expect(renderFrame(running,5000)).toContain('100%');
  const paused=transition(running,'pause',600,'c');expect(elapsed(paused,9000)).toBe(500);
  const resumed=transition(paused,'start',9000,'d');expect(elapsed(resumed,9250)).toBe(750);
  expect(transition(resumed,'complete',9500,'d').status).toBe('completed');
  expect(transition(resumed,'reset',9200,'e')).toEqual(initialState('e',1000));
  expect(()=>parseAnimation('{"id":"x"}')).toThrow();
});
async function edit(host:MemoryScreen,app:Awaited<ReturnType<typeof createAnimationApp>>,values:[string,string|boolean][]){
  const saved=(await host.getScreen('build'))!;
  await host.setScreen('build',patchValues(parseTextUI(saved.text),new Map(values)),{expectedRevision:saved.revision});await app.idle();
}
test('React low-frequency output, no unchanged writes, restart recovery and resource cleanup',async()=>{
  class CountingHost extends MemoryScreen {calls=0;override async setScreen(id:string,text:string,options:ScreenWriteOptions){this.calls++;return super.setScreen(id,text,options);}}
  const host=new CountingHost(),clock=new ManualClock(1000);let ids=0;
  let app=await createAnimationApp(host,clock,{newId:()=>`id${++ids}`});
  try{
    await app.startScheduling();await edit(host,app,[['start',true]]);
    expect(app.state().status).toBe('running');expect(clock.pending).toBe(1);
    const calls=host.calls,revision=(await host.getScreen('build'))!.revision;
    await app.tick();await app.tick();expect(host.calls).toBe(calls);expect((await host.getScreen('build'))!.revision).toBe(revision);
    clock.advance(3500);await app.tick();expect((await host.getScreen('build'))!.text).toContain('35%');
    await edit(host,app,[['pause',true],['note','external']]);const paused=app.state();clock.advance(5000);await app.tick();expect(app.state()).toEqual(paused);expect(clock.pending).toBe(0);
    await app.close();app=await createAnimationApp(host,clock);expect(app.state()).toEqual(paused);expect(app.root.store.read('note')).toBe('external');
    await app.startScheduling();await edit(host,app,[['start',true]]);clock.advance(6500);await app.tick();expect(app.state().status).toBe('completed');
    await app.idle();expect(clock.pending).toBe(0);
    await edit(host,app,[['reset',true]]);expect(app.state().status).toBe('idle');
  }finally{await app.close();}expect(clock.pending).toBe(0);
});
test('CAS conflict rereads latest text and preserves external controls and ordinary Markdown',async()=>{
  class RacingHost extends MemoryScreen {
    race=false;
    override async setScreen(id:string,text:string,options:ScreenWriteOptions){
      if(this.race && options.origin?.startsWith('textui:')){
        this.race=false;const saved=(await this.getScreen(id))!;
        await super.setScreen(id,patchValues(parseTextUI(saved.text),new Map([['note','concurrent edit']]))+'\n<!-- keep me -->\n',{expectedRevision:saved.revision,origin:'editor'});
      }
      return super.setScreen(id,text,options);
    }
  }
  const host=new RacingHost(),clock=new ManualClock(1000),app=await createAnimationApp(host,clock);
  try{await edit(host,app,[['start',true]]);clock.advance(2500);host.race=true;await app.tick();await app.idle();
    const saved=(await host.getScreen('build'))!;expect(saved.text).toContain('25%');expect(saved.text).toContain('concurrent edit');expect(saved.text).toContain('<!-- keep me -->');
  }finally{await app.close();}
});
test('temporary stream preserves revision, targets correct output and rejects stale/replaced/duplicate frames',async()=>{
  const host=new MemoryScreen(),clock=new ManualClock(1000),app=await createAnimationApp(host,clock,{stream:true,newId:()=>`id${clock.now()}`});
  try{
    await edit(host,app,[['start',true]]);const screen=(await host.getScreen('build'))!;
    const frame:TextFrame={screenId:'build',targetId:'progress',animationId:app.state().id,sequence:1,baseRevision:screen.revision,generatedAt:1000,markdown:'temporary'};
    const receiver=new FrameReceiver(),stream=new LocalFrameStream(),received:TextFrame[]=[];
    const stop=stream.onFrame('build',f=>received.push(f));stream.publishFrame(frame);stop();stream.publishFrame({...frame,sequence:2});expect(received).toEqual([frame]);expect(await host.getScreen('build')).toEqual(screen);
    expect(receiver.accept(frame,screen,1000)).toBe(true);expect(receiver.accept(frame,screen,1000)).toBe(false);
    for(const bad of [{sequence:0},{sequence:2,generatedAt:-2000},{sequence:2,targetId:'missing'},{sequence:2,baseRevision:'old'},{sequence:2,animationId:'old'},{sequence:2,screenId:'other'}])expect(receiver.accept({...frame,...bad},screen,1000)).toBe(false);
    clock.advance(1000);await edit(host,app,[['reset',true]]);await edit(host,app,[['start',true]]);
    expect(receiver.accept({...frame,sequence:100},(await host.getScreen('build'))!,2000)).toBe(false);
    clock.advance(1000);const before=(await host.getScreen('build'))!;await app.tick();expect(await host.getScreen('build')).toEqual(before);
  }finally{await app.close();}
});
test('demand scheduler cancels queued stale callbacks and creates no idle timers',async()=>{
  const clock=new ManualClock(),calls:string[]=[];
  const session=new AnimationSession(clock,async()=>{calls.push('pulse');},()=>{});
  session.refresh(false);expect(clock.pending).toBe(0);session.refresh(true);session.refresh(false);clock.advance(1000);expect(calls).toEqual([]);
  session.refresh(true);clock.advance(250);expect(calls).toEqual(['pulse']);session.close();expect(clock.pending).toBe(0);
});
test('real Node watcher preserves external text, then fresh host restores running animation at current time',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'textui-animation-')),clock=new ManualClock(1000),errors:Error[]=[];
  let host=createNodeHost(directory),app=await createAnimationApp(host,clock,{onError:e=>errors.push(e)});
  const path=join(directory,'build.md');
  try{
    const text=await readFile(path,'utf8');await writeFile(path,patchValues(parseTextUI(text),new Map<string,string|boolean>([['start',true],['note','Node editor']]))+'\n<!-- file note -->\n');
    await expect.poll(()=>app.state().status).toBe('running');await app.idle();
    clock.advance(2000);await app.tick();expect(await readFile(path,'utf8')).toContain('20%');
    await app.close();await host.close();clock.advance(3000);host=createNodeHost(directory);app=await createAnimationApp(host,clock);await app.tick();
    const saved=await readFile(path,'utf8');expect(saved).toContain('50%');expect(saved).toContain('Node editor');expect(saved).toContain('<!-- file note -->');expect(errors).toEqual([]);
  }finally{await app.close();await host.close();await rm(directory,{recursive:true,force:true});}
});
