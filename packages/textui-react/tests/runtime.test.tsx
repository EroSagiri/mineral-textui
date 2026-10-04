import {expect,test} from 'vitest';
import {useEffect,useState} from 'react';
import {MemoryScreen,parseTextUI,patchValues,ScreenConflictError} from '@mineral/textui';
import type {ScreenPort,ScreenChange} from '@mineral/textui';
import {render,Screen,Heading,Text,Input,Action,Output,useTextState} from '@mineral/textui-react';

test('React creates, updates and unmounts Host Tree through a memory port, with effect cleanup',async()=>{
  const host=new MemoryScreen();let update!:(n:number)=>void,cleaned=0;
  function App(){const [count,set]=useState(0);update=set;useEffect(()=>()=>{cleaned++;},[]);return <Screen><Heading>Memory</Heading><Text>Pure runtime</Text><Output id="count" label="Count" value={count}/></Screen>;}
  const root=await render(<App/>,{host,screen:'home'});
  await root.update(<App/>);update(2);
  for(let i=0;i<20 && !(await host.getScreen('home'))!.text.includes('Count: 2');i++)await new Promise(resolve=>setTimeout(resolve,5));
  await root.flush();expect((await host.getScreen('home'))!.text).toContain('Count: 2');
  expect(root.getTree().children).toHaveLength(1);await root.unmount();await root.unmount();expect(cleaned).toBe(1);
});

test('memory port hydrates before callbacks and each fresh Action triggers while replayed requests do not',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];let observed='';
  function App(){const [name]=useTextState('key','Default');const [count,set]=useTextState('count',0);return <Screen><Input id="name" stateKey="key" label="Name" value={name}/><Action id="go" label="Go" onTrigger={()=>{observed=name;set(n=>n+1);}}/><Output id="count" label="Count" value={count}/></Screen>;}
  let root=await render(<App/>,{host,screen:'home',onError:e=>errors.push(e)});
  const first=(await host.getScreen('home'))!;const request=patchValues(parseTextUI(first.text),new Map<string,string|boolean>([['name','New'],['go',true]]));
  await host.setScreen('home',request,{expectedRevision:first.revision});await root.idle();expect(observed).toBe('New');expect(root.store.read('count')).toBe(1);
  const second=(await host.getScreen('home'))!;await host.setScreen('home',request,{expectedRevision:second.revision});await root.idle();expect(root.store.read('count')).toBe(1);
  const third=(await host.getScreen('home'))!;await host.setScreen('home',patchValues(parseTextUI(third.text),new Map([['go',true]])),{expectedRevision:third.revision});await root.idle();expect(root.store.read('count')).toBe(2);
  await root.unmount();root=await render(<App/>,{host,screen:'home'});expect(root.store.read('key')).toBe('New');expect(root.store.read('count')).toBe(2);await root.unmount();expect(errors).toEqual([]);
});

test('slow conditional writes and own echoes do not create an event loop or overwrite a newer snapshot',async()=>{
  const base=new MemoryScreen();let release!:()=>void,pause=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});const errors:Error[]=[];
  const host:ScreenPort={getScreen:id=>base.getScreen(id),onScreenChange:(...args)=>base.onScreenChange(...args),async setScreen(id,text,options){if(pause)await gate;return base.setScreen(id,text,options);}};
  function App(){const [value]=useTextState('value','A');return <Input id="value" label="Value" value={value}/>;}
  const root=await render(<App/>,{host,screen:'home',onError:e=>errors.push(e)});
  const old=(await base.getScreen('home'))!;pause=true;root.store.set('value','Internal');const flush=root.flush();
  await Promise.resolve();await Promise.resolve();await base.setScreen('home',old.text.replace('[A]','[External]'),{expectedRevision:old.revision});release();
  await expect(flush).rejects.toBeInstanceOf(ScreenConflictError);await root.idle();expect(root.store.read('value')).toBe('External');expect((await base.getScreen('home'))!.text).toContain('[External]');await root.unmount();
});
