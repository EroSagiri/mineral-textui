import {describe,it,expect} from 'vitest';
import {MemoryScreen,ScreenConflictError} from '@mineral/textui';
import type {ScreenPort} from '@mineral/textui';
import {createDevtoolsBridge} from '../src/bridge.js';
import {cloneScreens,observeScreenPort} from '../src/api.js';

describe('generic development Bridge',()=>{
  it('connects three-method ports, preserves CAS and discovers only supplied or observed screens',async()=>{
    const memory=new MemoryScreen();
    const port:ScreenPort={getScreen:memory.getScreen.bind(memory),setScreen:memory.setScreen.bind(memory),onScreenChange:memory.onScreenChange.bind(memory)};
    expect(Object.keys(port)).toHaveLength(3);
    const first=await port.setScreen('custom/中文','# Hello',{expectedRevision:null});
    const bridge=createDevtoolsBridge({port,discovery:{async listScreens(){return [{id:'custom/中文',label:'Custom'}];}}},{enabled:true,instanceId:'host-1'});
    const read=()=>bridge.handleRequest(new Request('http://localhost/screens/'+encodeURIComponent(first.id)));
    expect((await (await read()).json()).screen).toEqual(first);
    const update=(revision:string)=>bridge.handleRequest(new Request('http://localhost/screens/'+encodeURIComponent(first.id),{method:'PUT',body:JSON.stringify({text:'# Updated',expectedRevision:revision})}));
    const written=await update(first.revision);expect(written.status).toBe(200);
    expect((await update(first.revision)).status).toBe(409);
    await bridge.port.getScreen('manual only');
    expect((await bridge.config()).screens.map(x=>x.id)).toEqual(['custom/中文','manual only']);
    expect(bridge.observation.events.some(x=>x.kind==='write')).toBe(true);
  });
  it('can be disabled and rejects unauthenticated or cross-origin development requests',async()=>{
    const session={port:new MemoryScreen()};
    expect((await createDevtoolsBridge(session,{enabled:false,instanceId:'1'}).handleRequest(new Request('http://localhost/config'))).status).toBe(404);
    const bridge=createDevtoolsBridge(session,{enabled:true,instanceId:'1',token:'secret'});
    expect((await bridge.handleRequest(new Request('http://localhost/config'))).status).toBe(401);
    expect((await bridge.handleRequest(new Request('http://localhost/config',{headers:{Authorization:'Bearer secret',Origin:'https://other.example'}}))).status).toBe(403);
    expect((await bridge.handleRequest(new Request('http://localhost/config',{headers:{Authorization:'Bearer secret'}}))).status).toBe(200);
  });
  it('clone edits never write source storage and observation preserves original errors',async()=>{
    const source=new MemoryScreen(),target=new MemoryScreen();
    const original=await source.setScreen('home','original',{expectedRevision:null});
    const [cloned]=await cloneScreens(source,target,['home']);
    await target.setScreen('home','sandbox edit',{expectedRevision:cloned.revision});
    expect(await source.getScreen('home')).toEqual(original);
    const observed=observeScreenPort(source,{known:new Set(),events:[]});
    await expect(observed.setScreen('home','bad',{expectedRevision:null})).rejects.toBeInstanceOf(ScreenConflictError);
  });
});
