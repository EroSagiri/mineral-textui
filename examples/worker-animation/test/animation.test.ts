import {env} from 'cloudflare:workers';
import {SELF,reset,evictDurableObject,runInDurableObject,runDurableObjectAlarm} from 'cloudflare:test';
import {afterEach,expect,test} from 'vitest';
import {parseTextUI,patchValues} from '@mineral/textui';
import type {ScreenSnapshot} from '@mineral/textui';
import {readAnimation} from '../../animation-demo/animation.js';
import type {TextFrame} from '../frame-stream.js';
interface Result {screen:ScreenSnapshot;instance:string;scheduled:boolean;subscribers:number;metrics:{writes:number;frames:number;messages:number}}
const endpoint=(id:string)=>`https://example.com/apps/${id}/screens/build`;
async function read(id:string){const r=await SELF.fetch(endpoint(id));expect(r.status).toBe(200);return r.json<Result>();}
async function edit(id:string,values:[string,string|boolean][],snapshot?:ScreenSnapshot){const screen=snapshot??(await read(id)).screen;const response=await SELF.fetch(endpoint(id),{method:'PUT',body:JSON.stringify({text:patchValues(parseTextUI(screen.text),new Map(values)),expectedRevision:screen.revision})});const result=await response.json<Result>();const status=response.status;return {status,json:async()=>result};}
async function connect(id:string){const response=await SELF.fetch(endpoint(id)+'/subscribe',{headers:{Upgrade:'websocket'}});expect(response.status).toBe(101);const socket=response.webSocket!;socket.accept();const messages:{type:string;frame?:TextFrame;screen?:ScreenSnapshot;instance?:string}[]=[];socket.addEventListener('message',event=>{messages.push(JSON.parse(String(event.data)));});return {socket,messages};}
afterEach(reset);
test('measure real workerd fanout over one second with no intermediate persistent writes',async()=>{
  const first=await connect('measure'),second=await connect('measure');
  try{
    await edit('measure',[['start',true]]);const before=await read('measure'),time=performance.now();
    await new Promise(resolve=>setTimeout(resolve,1100));
    const after=await read('measure');
    const report={windowMs:Math.round(performance.now()-time),subscribers:2,writes:after.metrics.writes-before.metrics.writes,frames:after.metrics.frames-before.metrics.frames,messages:after.metrics.messages-before.metrics.messages};
    expect(report.writes).toBe(0);expect(report.frames).toBeGreaterThanOrEqual(4);expect(report.messages).toBe(report.frames*2);expect(after.screen.revision).toBe(before.screen.revision);
    console.log('WORKER_ANIMATION_MEASURE',JSON.stringify(report));
  }finally{first.socket.close();second.socket.close();}
});
test('multiple subscribers receive transient frames without SQL/revision writes; ordinary edits, pause/reset invalidate old frames',async()=>{
  const first=await connect('frames'),second=await connect('frames');
  try{
    expect((await edit('frames',[['start',true]])).status).toBe(200);
    await expect.poll(()=>first.messages.filter(m=>m.type==='frame').length).toBeGreaterThan(1);
    const started=await read('frames');expect(started.scheduled).toBe(true);expect(started.subscribers).toBe(2);
    const oldId=readAnimation(started.screen.text).id;
    await expect.poll(()=>second.messages.filter(m=>m.type==='frame').length).toBeGreaterThan(2);
    const later=await read('frames');expect(later.screen.revision).toBe(started.screen.revision);expect(later.metrics.writes).toBe(started.metrics.writes);
    expect(first.messages.find(m=>m.frame)?.frame).toMatchObject({screenId:'build',targetId:'progress',animationId:oldId,baseRevision:started.screen.revision});
    expect((await edit('frames',[['note','while animating']])).status).toBe(200);
    const response=await edit('frames',[['pause',true]]);expect(response.status).toBe(200);
    const paused=await response.json();expect(paused.scheduled).toBe(false);expect(paused.screen.text).toContain('while animating');expect(readAnimation(paused.screen.text).id).not.toBe(oldId);
    await edit('frames',[['reset',true]]);await edit('frames',[['start',true]]);
    expect(readAnimation((await read('frames')).screen.text).id).not.toBe(oldId);
  }finally{first.socket.close();second.socket.close();}
  await expect.poll(async()=>(await read('frames')).scheduled).toBe(false);
  const stopped=await read('frames');await new Promise(resolve=>setTimeout(resolve,350));expect((await read('frames')).metrics.frames).toBe(stopped.metrics.frames);
});
test('forced hibernation rebuilds React/state and retains socket attachments; reconnect snapshots skip history and actions do not replay',async()=>{
  const connection=await connect('restore'),stub=env.ANIMATION_APPS.getByName('restore');
  try{
    await edit('restore',[['start',true],['note','restore me']]);const before=await read('restore');
    await expect.poll(()=>connection.messages.some(m=>m.type==='frame')).toBe(true);
    await runInDurableObject(stub,instance=>instance.suspendFrameDelivery());
    await evictDurableObject(stub,{webSockets:'hibernate'});connection.socket.send('snapshot');
    await expect.poll(()=>connection.messages.some(m=>m.type==='snapshot'&&m.instance!==before.instance)).toBe(true);
    const after=await read('restore');expect(after.instance).not.toBe(before.instance);expect(after.screen).toEqual(before.screen);expect(readAnimation(after.screen.text)).toEqual(readAnimation(before.screen.text));
    expect(parseTextUI(after.screen.text).controls.get('start')?.value).toBe(false);
    const seq=connection.messages.filter(m=>m.frame).at(-1)!.frame!.sequence;connection.socket.send('snapshot');await expect.poll(()=>connection.messages.some(m=>m.frame && m.frame.sequence>seq)).toBe(true);
  }finally{connection.socket.close();}
  const reconnect=await connect('restore');try{reconnect.socket.send('snapshot');await expect.poll(()=>reconnect.messages.some(m=>m.type==='snapshot'&&m.screen?.text.includes('restore me'))).toBe(true);}finally{reconnect.socket.close();}
});
test('no demand timers without subscribers; completion Alarm survives eviction and is idempotent; stale CAS preserves winning edit',async()=>{
  const initial=await read('alarm');await edit('alarm',[['start',true]],initial.screen);
  const running=await read('alarm');expect(running.scheduled).toBe(false);expect(running.metrics.frames).toBe(0);
  const responses=await Promise.all([edit('alarm',[['note','winner A']],running.screen),edit('alarm',[['note','winner B']],running.screen)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const stub=env.ANIMATION_APPS.getByName('alarm');
  // Move persisted start time into the past, then evict the actual workerd object.
  await runInDurableObject(stub,(_instance,state)=>{
    const row=state.storage.sql.exec<{text:string}>('SELECT text FROM screens WHERE id = ?','build').one();
    const animation=readAnimation(row.text);const text=row.text.replace(JSON.stringify(animation),JSON.stringify({...animation,startedAt:Date.now()-20_000}));
    state.storage.sql.exec('UPDATE screens SET text=?, revision=? WHERE id=?',text,crypto.randomUUID(),'build');
  });
  await evictDurableObject(stub);await runDurableObjectAlarm(stub);
  const completed=await read('alarm');expect(readAnimation(completed.screen.text).status).toBe('completed');expect(completed.screen.text).toContain('100%');expect(completed.screen.text).toMatch(/winner [AB]/);expect(completed.scheduled).toBe(false);
  await runInDurableObject(stub,async(instance,state)=>{await instance.alarm();expect(await state.storage.getAlarm()).toBeNull();expect(state.storage.sql.exec('SELECT id FROM screens').toArray()).toHaveLength(1);});
  expect((await read('alarm')).screen).toEqual(completed.screen);
});
test('completion with subscribers stops frames; invalid Block and removed target never overwrite Screen',async()=>{
  const initial=await read('finish');const animation=readAnimation(initial.screen.text);
  const response=await SELF.fetch(endpoint('finish'),{method:'PUT',body:JSON.stringify({text:initial.screen.text.replace(JSON.stringify(animation),JSON.stringify({...animation,durationMs:500})),expectedRevision:initial.screen.revision})});expect(response.status).toBe(200);await response.json();
  const connection=await connect('finish');
  try{
    await edit('finish',[['start',true]]);
    await expect.poll(async()=>readAnimation((await read('finish')).screen.text).status).toBe('completed');
    const completed=await read('finish');expect(completed.scheduled).toBe(false);
    await new Promise(resolve=>setTimeout(resolve,350));const after=await read('finish');expect(after.metrics.frames).toBe(completed.metrics.frames);expect(after.screen).toEqual(completed.screen);
    for(const text of [completed.screen.text.replace('"durationMs":500','"durationMs":0'),completed.screen.text.replace(/^Progress:.*\n/m,'')]){
      const bad=await SELF.fetch(endpoint('finish'),{method:'PUT',body:JSON.stringify({text,expectedRevision:completed.screen.revision})});expect(bad.status).toBe(400);await bad.json();expect((await read('finish')).screen).toEqual(completed.screen);
    }
  }finally{connection.socket.close();}
});
