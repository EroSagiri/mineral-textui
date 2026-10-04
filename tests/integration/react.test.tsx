import { expect, test } from 'vitest';
import { useEffect, useState } from 'react';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {Screen,Input,Heading,Text,Check,Select,Action,Output,render,useTextState} from '@mineral/textui-react';
import {parseTextUI} from '@mineral/textui';
import {createNodeHost} from '@mineral/textui-host-node';
import { patchValues } from '@mineral/textui';
import { UserForm } from '../../examples/user-form/app.tsx';
import { patchTree } from '@mineral/textui';
import { serializeTree } from '@mineral/textui';
import type { ElementNode } from '@mineral/textui';
import { semanticDiff } from '@mineral/textui';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { UIEvent } from '@mineral/textui';

test('one Root rejects sibling or nested Screens before writing',async()=>{
  const f=fixture();
  try{
    await expect(render(<><Screen/><Screen/></>,{host:f.host,screen:'user',onError:()=>{}})).rejects.toThrow('一个 Screen');
    expect(await f.host.getScreen('user')).toBeNull();
    await expect(render(<Screen><Screen/></Screen>,{host:f.host,screen:'user',onError:()=>{}})).rejects.toThrow('一个 Screen');
    expect(await f.host.getScreen('user')).toBeNull();
  }finally{await f.cleanup();}
});

test('initializer receives current subscribed snapshot once',async()=>{
  const f=fixture();let calls=0;
  const original=await render(<Screen><Output id="value" label="Value" value="saved"/></Screen>,{host:f.host,screen:'user'});
  await original.unmount();
  const expected=await f.host.getScreen('user');
  const root=await render(snapshot=>{calls++;expect(snapshot).toEqual(expected);return <Screen><Output id="value" label="Value" value="saved"/></Screen>;},{host:f.host,screen:'user'});
  try{await root.flush();expect(calls).toBe(1);}finally{await root.unmount();await f.cleanup();}
});

async function until(check: () => boolean) {
  for (let i=0;i<300;i++) {if (check()) return; await delay(10);} throw new Error('文件响应超时');
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(),'textui-react-')), file = join(dir,'user.md');
  const errors: Error[] = [];
  const host=createNodeHost(dir,{onError:error=>errors.push(error as Error)});
  const read = () => readFileSync(file,'utf8');
  const doc = () => parseTextUI(read());
  const id = (label:string) => [...doc().controls.values()].find(c => c.label === label)!.id;
  const value = (label:string) => doc().controls.get(id(label))!.value;
  const edit = (updates: Record<string,string|boolean>) => {
    const text = patchValues(doc(),new Map(Object.entries(updates))); writeFileSync(file,text); return text;
  };
  return {dir,file,host,errors,read,doc,id,value,edit,cleanup:async() => {await host.close();rmSync(dir,{recursive:true,force:true});}};
}

test('React components, Hooks, updates and effect cleanup run without DOM', async () => {
  const f = fixture(); let set!: (value:number) => void; let mounted=0, cleaned=0;
  function App() {
    const [count, update] = useState(0); set = update;
    useEffect(() => {mounted++; return () => {cleaned++;};},[]);
    return <Screen><Heading>Title</Heading><Text>ordinary markdown</Text><Output id="count" label="Count" value={count}/></Screen>;
  }
  const root = await render(<App/>,{host:f.host,screen:'user'});
  try {
    expect(mounted).toBe(1); expect(f.read()).toContain('# Title');
    set(2); await until(() => f.value('Count') === '2');
    expect(root.getTree().children.length).toBe(1);
  } finally {await root.unmount(); await f.cleanup();}
  expect(cleaned).toBe(1);
});

test('User form transactions restore fields, independent counters, read-only outputs and replay protection', async () => {
  const f=fixture(); let root=await render(<UserForm/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    const note='\n## 外部备注\n保留我的空格。  \n<!-- ordinary -->\n';
    writeFileSync(f.file,f.read()+note); await delay(100);
    const request=f.edit({[f.id('Name')]:'Ada]\\L',[f.id('Enable sound')]:false,[f.id('Light')]:true,'submit-main':true,'submit-preview':true});
    await until(() => f.value('Preview count')==='1');
    expect(f.value('Main count')).toBe('1'); expect(f.value('Dark')).toBe(false);
    expect(f.value('Result')).toContain('Name=Ada]\\L；sound=off；theme=light');
    expect(f.doc().controls.get('submit-main')!.value).toBe(false); expect(f.read()).toContain(note);
    writeFileSync(f.file,request); await until(() => f.doc().controls.get('submit-main')!.value===false);
    expect(f.value('Main count')).toBe('1');
    f.edit({'submit-main':true}); await until(() => f.value('Main count')==='2');
    await root.unmount(); root=await render(<UserForm/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
    expect(root.store.read('name')).toBe('Ada]\\L'); expect(root.store.read('theme')).toBe('light');
    expect(root.store.read('main-count')).toBe(2); expect(f.value('Preview count')).toBe('1');
    expect(f.errors).toEqual([]);
    f.edit({[f.id('Result')]:'tampered'}); await until(() => f.value('Result')!=='tampered');
    expect(f.errors[0].message).toContain('只读输出');
    expect(f.read()).toContain(note);
  } finally {await root.unmount(); await f.cleanup();}
});

test('file events use document order, hydrate before callbacks and permit Check in both directions', async () => {
  const f=fixture(); const events:UIEvent[]=[]; let observed='';
  function App() {
    const [name] = useTextState('internal-name','Initial'); const [sound] = useTextState('internal-sound',true);
    const [theme]=useTextState('internal-theme','dark');
    return <Screen>
      <Input id="name" stateKey="internal-name" label="Name" value={name} onChange={e=>events.push(e)}/>
      <Check id="sound" stateKey="internal-sound" label="Sound" checked={sound} onChange={e=>events.push(e)}/>
      <Select group="theme" stateKey="internal-theme" value={theme} options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]} onSelect={e=>events.push(e)}/>
      <Action id="submit" label="Submit" onTrigger={e=>{events.push(e); observed=name;}}/>
    </Screen>;
  }
  const root=await render(<App/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    f.edit({name:'New',sound:false,[f.id('Light')]:true,submit:true}); await until(()=>observed==='New');
    expect(events.map(e=>e.type)).toEqual(['change','change','select','trigger']);
    expect(events[2]).toMatchObject({before:'dark',after:'light'});
    f.edit({sound:true}); await until(()=>events.length===5); expect(events[4]).toMatchObject({after:true});
    await delay(100); expect(events).toHaveLength(5); expect(f.errors).toEqual([]);
  } finally {await root.unmount(); await f.cleanup();}
});



test('startup retains CRLF, restores state, resets stale Action without callback and rejects bad persisted state', async () => {
  const f=fixture(); let actions=0;
  function App() {const [name]=useTextState('field','Default'); return <Screen><Input id="name" label="Name" value={name} stateKey="field"/><Action id="a" label="Go" onTrigger={()=>actions++}/></Screen>;}
  const content='# 私人标题\r\nName: [Saved] <!-- textui:type=input id=name -->\r\n- [x] Go <!-- textui:type=action id=a -->\r\n\t \r\n';
  writeFileSync(f.file,content); const root=await render(<App/>,{host:f.host,screen:'user'});
  try {expect(root.store.read('field')).toBe('Saved'); expect(actions).toBe(0); expect(f.doc().controls.get('a')!.value).toBe(false); expect(f.read()).toContain('\r\n\t \r\n'); expect(f.read().replaceAll('\r\n','')).not.toContain('\n');}
  finally {await root.unmount(); await f.cleanup();}
});

test('invalid file batches execute no handlers and recover from the last confirmed baseline', async () => {
  const f=fixture(); const root=await render(<UserForm/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    const before=f.read(); writeFileSync(f.file,before+'\n- [x] Duplicate <!-- textui:id=submit-main type=action -->\n');
    await until(()=>f.errors.length===1); expect(root.store.read('main-count')).toBe(0);
    writeFileSync(f.file,patchValues(parseTextUI(before),new Map([['submit-main',true]])));
    await until(()=>f.value('Main count')==='1');
  } finally {await root.unmount(); await f.cleanup();}
});

test('React updates patch headings, text, renamed controls and component addition/removal without deleting notes', async () => {
  const f=fixture(); let update!:(value:boolean)=>void;
  function App() {
    const [changed,set]=useState(false); update=set;
    return <Screen><Heading>{changed?'Updated':'Original'}</Heading><Text>{changed?'New text':'Old text'}</Text>
      <Output id="x" label={changed?'Renamed':'Name'} value={changed?'B':'A'}/>
      {changed?<Check id="added" label="Added"/>:<Check id="removed" label="Removed"/>}
    </Screen>;
  }
  const root=await render(<App/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    writeFileSync(f.file,f.read()+'\n<!-- unrelated -->\nMy note.  \n'); await delay(120);
    update(true); await until(()=>f.doc().controls.has('added'));
    expect(f.doc().controls.has('removed')).toBe(false); expect(f.value('Renamed')).toBe('B');
    expect(f.read()).toContain('# Updated'); expect(f.read()).toContain('New text'); expect(f.read()).toContain('My note.  \n');
    expect(f.errors).toEqual([]);
  } finally {await root.unmount(); await f.cleanup();}
});


test('failed handlers keep Action pending, roll back persistent state and never write queued partial commits', async () => {
  const f=fixture(); let fail=true;
  function App() {
    const [count,setCount]=useTextState('count',0);
    return <Screen><Action id="go" label="Go" onTrigger={()=>{setCount(n=>n+1); if(fail) throw new Error('failed');}}/>
      <Output id="count" label="Count" value={count}/></Screen>;
  }
  const root=await render(<App/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    const pending=f.edit({go:true}); await until(()=>f.errors.length===1); await delay(100);
    expect(root.store.read('count')).toBe(0); expect(f.read()).toBe(pending);
    fail=false; writeFileSync(f.file,f.read()+'\nretry\n'); await until(()=>f.value('Count')==='1');
    expect(f.doc().controls.get('go')!.value).toBe(false);
  } finally {await root.unmount(); await f.cleanup();}
});

test('file conflicts preserve edits and roots release their single-writer ownership after unmount', async () => {
  const f=fixture(); const root=await render(<UserForm/>,{host:f.host,screen:'user',onError:e=>f.errors.push(e)});
  try {
    await expect(render(<UserForm/>,{host:f.host,screen:'user'})).rejects.toThrow(/两个运行中的/);
    const edited=f.edit({[f.id('Name')]:'External'});
    root.store.set('name','Internal'); await expect(root.flush()).rejects.toThrow(/版本冲突/);
    expect(f.read()).toBe(edited);
    await until(()=>root.store.read('name')==='External');
    const replacement=join(f.dir,'replacement.md'); writeFileSync(replacement,patchValues(f.doc(),new Map([['submit-main',true]]))); renameSync(replacement,f.file);
    await until(()=>f.value('Main count')==='1'); f.edit({'submit-main':true}); await until(()=>f.value('Main count')==='2');
  } finally {await root.unmount();}
  const reopened=await render(<UserForm/>,{host:f.host,screen:'user'}); await reopened.unmount(); await f.cleanup();
});

test('bad startup state and unbound persistent keys fail without overwriting the existing file', async () => {
  const f=fixture(); writeFileSync(f.file,'Count: broken <!-- textui:id=count type=output -->\n');
  function App() {const [count]=useTextState('count',0); return <Output id="count" label="Count" value={count}/>;}
  try {
    await expect(render(<App/>,{host:f.host,screen:'user'})).rejects.toThrow(/数值无效/);
    expect(f.read()).toContain('broken');
    writeFileSync(f.file,'Count: 7 <!-- textui:id=count type=output -->\n');
    const root=await render(<App/>,{host:f.host,screen:'user'}); expect(root.store.read('count')).toBe(7); await root.unmount();
    function Unbound() {useTextState('missing','default'); return <Text>nothing persisted</Text>;}
    await expect(render(<Unbound/>,{host:f.host,screen:'user'})).rejects.toThrow(/未绑定控件/);
  } finally {await f.cleanup();}
});

test('real Node CLI runs JSX user form and persists submits without DOM', async () => {
  const f=fixture(); const runner=fileURLToPath(new URL('../../examples/user-form/run.tsx',import.meta.url));
  const child=spawn(process.execPath,['--import','tsx',runner,f.file],{stdio:['ignore','pipe','pipe']});
  let out='', errors=''; child.stdout.on('data',data=>{out+=data;}); child.stderr.on('data',data=>{errors+=data;});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  try {
    await until(()=>out.includes(`正在监听：${f.file}`));
    f.edit({'submit-main':true}); await until(()=>f.value('Main count')==='1');
    expect(errors).toBe(''); expect(child.exitCode).toBeNull();
  } finally {child.kill(); await exited; await f.cleanup();}
});
