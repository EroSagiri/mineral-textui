import {expect,test,vi} from 'vitest';
import {MemoryScreen,parseTextUI,patchValues} from '@mineral/textui';
import type {ScreenPort,UIEvent} from '@mineral/textui';
import {createTaskApp,taskScreenId} from '../../examples/task-app/app.js';
async function edit(host:ScreenPort,values:[string,string|boolean][]){
  const before=(await host.getScreen(taskScreenId))!;
  return host.setScreen(taskScreenId,patchValues(parseTextUI(before.text),new Map(values)),{expectedRevision:before.revision});
}
test('text Actions navigate React Router inside one Screen and persist off-page business state',async()=>{
  const host=new MemoryScreen(),read=vi.spyOn(host,'getScreen'),events:UIEvent[]=[];
  let app=await createTaskApp(host,{onEvent:event=>events.push(event)});
  try{
    await edit(host,[['name','开发者'],['nav-tasks',true]]);await app.idle();
    let snapshot=(await host.getScreen('app'))!;
    expect(snapshot.text).toContain('当前页面: /tasks');expect(snapshot.text).not.toContain('称呼:');expect(parseTextUI(snapshot.text).controls.get('nav-tasks')!.value).toBe(false);
    await edit(host,[['prototype',true],['docs',true],['nav-settings',true]]);await app.idle();
    snapshot=(await host.getScreen('app'))!;expect(snapshot.text).toContain('启用通知');expect(snapshot.text).not.toContain('完成原型');
    await edit(host,[['notifications',true],['light',true],['dark',false]]);await app.idle();
    await app.close();const count=events.length;app=await createTaskApp(host,{onEvent:event=>events.push(event)});await app.idle();
    expect(events).toHaveLength(count);snapshot=(await host.getScreen('app'))!;expect(snapshot.text).toContain('当前页面: /settings');expect(snapshot.text).toContain('主题：Light');
    await edit(host,[['nav-home',true]]);await app.idle();snapshot=(await host.getScreen('app'))!;
    expect(snapshot.text).toContain('[开发者]');expect(snapshot.text).toContain('今天还有 1 项任务待完成');
    await edit(host,[['nav-tasks',true]]);await app.idle();expect(parseTextUI((await host.getScreen('app'))!.text).controls.get('prototype')!.value).toBe(true);
    expect(new Set(read.mock.calls.map(([id])=>id))).toEqual(new Set(['app']));
  }finally{await app.close();}
});
test('navigation is text-only; unchanged content and runtime restoration never replay Actions',async()=>{
  const host=new MemoryScreen(),events:UIEvent[]=[];let app=await createTaskApp(host,{onEvent:event=>events.push(event)});
  try{
    const before=(await host.getScreen('app'))!;await host.setScreen('app',before.text,{expectedRevision:before.revision});await app.idle();expect(events).toEqual([]);
    await edit(host,[['nav-tasks',true]]);await app.idle();expect(events).toEqual([{type:'trigger',target:'nav-tasks'}]);
    await app.close();app=await createTaskApp(host,{onEvent:event=>events.push(event)});await app.idle();expect(events).toHaveLength(1);
    expect((await host.getScreen('app'))!.text).toContain('当前页面: /tasks');
  }finally{await app.close();}
});
test('an external note outside the page Section survives routing',async()=>{
  const host=new MemoryScreen(),app=await createTaskApp(host);
  try{const before=(await host.getScreen('app'))!;await host.setScreen('app',before.text+'\nExternal note\n',{expectedRevision:before.revision});await app.idle();await edit(host,[['nav-tasks',true]]);await app.idle();expect((await host.getScreen('app'))!.text).toContain('External note');}
  finally{await app.close();}
});

test('routing fails closed when replacing a Section would discard an external note',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[],app=await createTaskApp(host,{onError:error=>errors.push(error)});
  try{
    const before=(await host.getScreen('app'))!;
    const noted=before.text.replace('# 首页','# 首页\n\nExternal note inside page');
    await host.setScreen('app',noted,{expectedRevision:before.revision});await app.idle();
    await edit(host,[['nav-tasks',true]]);
    await app.root.idle();expect(errors).toHaveLength(1);expect(errors[0].message).toContain('无法安全更新结构');
    const failed=(await host.getScreen('app'))!;
    expect(failed.text).toContain('External note inside page');expect(failed.text).toContain('称呼:');
    expect(failed.text).not.toContain('完成原型');
    await host.setScreen('app',before.text,{expectedRevision:failed.revision});await app.root.idle();await app.root.flush();
    await edit(host,[['nav-tasks',true]]);await app.root.idle();await app.root.flush();expect((await host.getScreen('app'))!.text).toContain('完成原型');
  }finally{await app.close();}
});
