import {env} from 'cloudflare:workers';
import {SELF,evictDurableObject,runInDurableObject,reset} from 'cloudflare:test';
import {afterEach,expect,test} from 'vitest';
import {parseTextUI,patchValues} from '@mineral/textui';
import type {ScreenSnapshot,UIEvent} from '@mineral/textui';
interface Result{screen:ScreenSnapshot;instance:string;events:{screen:string;event:UIEvent}[]}
const endpoint=(app:string)=>`https://example.com/apps/${app}/screen`;
async function read(app:string){const response=await SELF.fetch(endpoint(app));expect(response.status).toBe(200);return response.json<Result>();}
async function edit(app:string,values:[string,string|boolean][],saved?:ScreenSnapshot){const screen=saved??(await read(app)).screen;return SELF.fetch(endpoint(app),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({text:patchValues(parseTextUI(screen.text),new Map(values)),expectedRevision:screen.revision})});}
afterEach(reset);
test('one SQLite screen restores React Router and every page state after runtime recreation and DO eviction',async()=>{
  expect((await read('persist')).screen.text).toContain('今天还有 3 项任务待完成');
  for(const values of [
    [['name','测试者'],['nav-tasks',true]],
    [['prototype',true],['nav-settings',true]],
    [['notifications',true],['dark',false],['light',true]],
  ] as [string,string|boolean][][]){const response=await edit('persist',values);expect(response.status).toBe(200);expect((await response.json<Result>()).events.every(value=>value.screen==='app')).toBe(true);}
  const before=await read('persist');expect(before.screen.text).toContain('当前页面: /settings');expect(before.screen.text).toContain('主题：Light');
  const stub=env.TASK_APPS.getByName('persist');await runInDurableObject(stub,(_instance,state)=>{expect(state.storage.sql.exec('SELECT id FROM screens').toArray()).toEqual([{id:'app'}]);});
  await evictDurableObject(stub);const restored=await read('persist');expect(restored.instance).not.toBe(before.instance);expect(restored.screen).toEqual(before.screen);expect(restored.events).toEqual([]);
  const home=await edit('persist',[['nav-home',true]]);expect(home.status).toBe(200);const screen=(await home.json<Result>()).screen;expect(screen.id).toBe('app');expect(screen.text).toContain('[测试者]');expect(screen.text).toContain('今天还有 2 项任务待完成');
  expect((await read('other')).screen.text).toContain('今天还有 3 项任务待完成');
});
test('stale writers yield HTTP 409; damaged schema, state edits and legacy screen URLs are rejected',async()=>{
  const before=(await read('conflict')).screen;const responses=await Promise.all([edit('conflict',[['name','one']],before),edit('conflict',[['name','two']],before)]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
  const saved=(await read('conflict')).screen;
  for(const text of ['# missing controls',saved.text.replace('"path":"/"','"path":"/tasks"')]){const bad=await SELF.fetch(endpoint('conflict'),{method:'PUT',body:JSON.stringify({text,expectedRevision:saved.revision})});expect(bad.status).toBe(400);expect((await read('conflict')).screen).toEqual(saved);}
  expect((await SELF.fetch('https://example.com/apps/conflict/screens/home')).status).toBe(404);
});
test('one Screen WebSocket survives hibernation and publishes text navigation changes',async()=>{
  const before=await read('subscribe'),stub=env.TASK_APPS.getByName('subscribe');const response=await stub.fetch(`${endpoint('subscribe')}/subscribe`,{headers:{Upgrade:'websocket'}});expect(response.status).toBe(101);
  const socket=response.webSocket!;socket.accept();const messages:string[]=[];socket.addEventListener('message',event=>{messages.push(String(event.data));});
  try{
    const first=await edit('subscribe',[['nav-tasks',true]]);expect(first.status).toBe(200);await first.json();await expect.poll(()=>messages.some(message=>JSON.parse(message).type==='change')).toBe(true);
    await evictDurableObject(stub,{webSockets:'hibernate'});socket.send('snapshot');await expect.poll(()=>messages.some(message=>JSON.parse(message).type==='snapshot')).toBe(true);
    const snapshot=JSON.parse(messages.find(message=>JSON.parse(message).type==='snapshot')!);expect(snapshot.instance).not.toBe(before.instance);expect(snapshot.screen.id).toBe('app');expect(snapshot.screen.text).toContain('当前页面: /tasks');
    const second=await edit('subscribe',[['prototype',true],['nav-home',true]]);expect(second.status).toBe(200);expect((await second.json<Result>()).screen.text).toContain('今天还有 2 项任务待完成');
  }finally{socket.close(1000);}
});
