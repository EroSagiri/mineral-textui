import {expect,test} from 'vitest';
import {useState} from 'react';
import {MemoryScreen,parseTextUI,BlockTypeRegistry,registerBlockType,semanticDiff,serializeTree,patchTree,patchValues,fencedCode} from '@mineral/textui';
import type {ElementNode,UIEvent,ScreenPort,ScreenChange} from '@mineral/textui';
import {render,Screen,Heading,Text,Divider,Link,Image,Code,CodeBlock,Quote,Section,List,OrderedList,ListItem,Table,Block,Input,Check,Action,Output,useTextState} from '@mineral/textui-react';

const element=(type:string,props:Record<string,unknown>={},children:ElementNode['children']=[]):ElementNode=>({kind:'element',type,props,children});

test('Markdown components compose inline formatting, nested lists, quotes and aligned GFM tables',async()=>{
  const host=new MemoryScreen();
  const root=await render(<Screen><Heading level={2}>Showcase</Heading><Text>Visit <Link href="https://example.com/a(b)" title="Docs">docs</Link> and <Code>{'`x`'}</Code>.</Text><Image src="https://example.com/a.png" alt="A [picture]"/><Divider/><Quote><Text>First</Text><Text>Second</Text></Quote><Section title="Lists" level={3}><OrderedList start={3}><ListItem>One<List><ListItem>Nested</ListItem></List></ListItem><ListItem>Two</ListItem></OrderedList></Section><Table columns={[{key:'name',title:'Name',align:'left'},{key:'state',title:'Status',align:'right'}]} rows={[{name:'A|B',state:'**Online**'},{name:'C\\|D',state:'`ready`'}]}/></Screen>,{host,screen:'show'});
  const text=(await host.getScreen('show'))!.text;
  expect(text).toContain('## Showcase');expect(text).toContain('[docs](<https://example.com/a(b)> "Docs")');expect(text).toContain('`` `x` ``');expect(text).toContain('> First\n> \n> Second');expect(text).toContain('3. One\n   \n   - Nested\n4. Two');expect(text).toContain('| :--- | ---: |');expect(text).toContain('A\\|B');expect(text).toContain('**Online**');expect(text).not.toContain('textui:');
  await root.unmount();
});

test('arbitrary code languages, empty language and long fences retain exact bodies',async()=>{
  const host=new MemoryScreen(),value='  first\n```\n```````\nlast\n';
  const root=await render(<Screen><CodeBlock lang="made-up" meta="title=example">{value}</CodeBlock><CodeBlock>{'plain'}</CodeBlock><Block type="unregistered" id="raw" value={value}/></Screen>,{host,screen:'code'});
  const text=(await host.getScreen('code'))!.text;
  expect(text).toContain('````````made-up title=example\n'+value+'\n````````');expect(text).toContain('```\nplain\n```');expect(parseTextUI(text).blocks.get('raw')!.value).toBe(value);await root.unmount();
});

test('Block ranges, empty bodies, CRLF, unknown types and invalid metadata are explicit',()=>{
  const text='Before\r\n~~~textui id=x type=unknown\r\n  a\r\nb\r\n~~~\r\nAfter\r\n';
  const block=parseTextUI(text).blocks.get('x')!;
  expect(block.value).toBe('  a\r\nb');expect(text.slice(block.start,block.end)).toBe(block.value);expect(text.slice(block.fullStart,block.fullEnd)).toContain('~~~textui');
  expect(parseTextUI('```textui type=x\n```').blocks.values().next().value!.value).toBe('');
  for(const meta of ['id=x','type=x type=y','type=x nope=yes','type=x id=bad/id'])expect(()=>parseTextUI('```textui '+meta+'\na\n```')).toThrow();
  expect(()=>parseTextUI('```textui type=x\na')).toThrow(/未闭合/);
  expect(()=>parseTextUI('```textui type=x id=dup\na\n```\nA: [b] <!-- textui:type=input id=dup -->')).toThrow(/重复/);
  expect(()=>parseTextUI('```textui type=x\na\n```\n```textui type=x\nb\n```')).toThrow(/歧义/);
});

test('Block changes and derived semantic events respect stable identity and source order',()=>{
  const types=new BlockTypeRegistry();
  types.register('number',{parse:text=>Number(text),serialize:String,deriveEvents:(a,b)=>[{delta:b-a}]});
  const before=parseTextUI('```textui type=number id=n\n1\n```\nName: [A] <!-- textui:type=input id=name -->');
  const after=parseTextUI(before.text.replace('\n1\n','\n2\n').replace('[A]','[B]'));
  expect(semanticDiff(before,after,{},types)).toEqual([{type:'textChange',target:'n',before:'1',after:'2'},{type:'blockEvent',target:'n',event:{delta:1}},{type:'change',target:'name',before:'A',after:'B'}]);
  expect(types.serialize('number',3)).toBe('3');expect(types.parse('unknown','raw')).toBe('raw');expect(()=>types.register('number',{parse:String,serialize:String})).toThrow(/已注册/);
  const unregister=registerBlockType('temporary',{parse:String,serialize:String});unregister();unregister();
  expect(()=>semanticDiff(before,parseTextUI(after.text.replace('type=number','type=other')))).toThrow(/类型/);
  expect(()=>semanticDiff(before,parseTextUI('Name: [A] <!-- textui:type=input id=name -->'))).toThrow(/删除/);
});

test('Block external edits hydrate persistent text, dispatch once, update outputs and survive restart',async()=>{
  const base=new MemoryScreen(),events:UIEvent[]=[],errors:Error[]=[];let notify!:(event:ScreenChange)=>void;
  const host:ScreenPort={getScreen:id=>base.getScreen(id),setScreen:(...args)=>base.setScreen(...args),async onScreenChange(id,listener){notify=listener;return base.onScreenChange(id,listener);}};
  const types=new BlockTypeRegistry();types.register('number',{parse:text=>{const value=Number(text);if(!Number.isFinite(value))throw new Error('invalid number');return value;},serialize:String,deriveEvents:(a,b)=>[{delta:b-a}]});
  function App(){const [text,set]=useTextState('body','1');return <Screen><Text>ordinary</Text><Block id="body" type="number" value={text} onTextChange={e=>{events.push(e);set(e.after);}} onEvent={e=>events.push(e)}/><Output id="result" label="Result" value={Number(text)*2}/></Screen>;}
  let root=await render(<App/>,{host,screen:'x',blockTypes:types,onError:e=>errors.push(e)});
  const initial=(await base.getScreen('x'))!;
  const edit=await base.setScreen('x','<!-- user note -->\n'+initial.text.replace('\n1\n','\n3\n'),{expectedRevision:initial.revision});
  notify({before:initial,after:edit});notify({before:initial,after:edit});await root.idle();
  expect(events).toHaveLength(2);expect(root.store.read('body')).toBe('3');expect((await base.getScreen('x'))!.text).toContain('Result: 6');expect((await base.getScreen('x'))!.text).toContain('<!-- user note -->');
  root.store.set('body','4');await root.flush();await root.idle();expect(events).toHaveLength(2);
  const stable=(await base.getScreen('x'))!;await root.flush();expect((await base.getScreen('x'))!.revision).toBe(stable.revision);
  await root.unmount();root=await render(<App/>,{host,screen:'x',blockTypes:types,onError:e=>errors.push(e)});expect(root.store.read('body')).toBe('4');expect(errors).toEqual([]);await root.unmount();
});

test('application components may compose Block without a registered parser',async()=>{
  const host=new MemoryScreen();let received='';
  function Custom(){const [value,set]=useState('hello');return <Block lang="application" type="custom" id="c" value={value} onTextChange={e=>{received=e.after;set(e.after);}}/>;}
  const root=await render(<Custom/>,{host,screen:'x'}),before=(await host.getScreen('x'))!;
  await host.setScreen('x',before.text.replace('hello','external'),{expectedRevision:before.revision});await root.idle();expect(received).toBe('external');expect(parseTextUI((await host.getScreen('x'))!.text).blocks.get('c')!.value).toBe('external');await root.unmount();
});

test('invalid registered data stops the entire batch before callbacks and preserves user bytes',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];let calls=0;
  const types=new BlockTypeRegistry();types.register('valid',{parse:text=>{if(text==='bad')throw new Error('bad data');return text;},serialize:String});
  const root=await render(<Screen><Block id="b" type="valid" value="ok" onTextChange={()=>calls++}/><Action id="go" label="Go" onTrigger={()=>calls++}/></Screen>,{host,screen:'x',blockTypes:types,onError:e=>errors.push(e)});
  const before=(await host.getScreen('x'))!,edit=before.text.replace('\nok\n','\nbad\n').replace('[ ]','[x]');
  await host.setScreen('x',edit,{expectedRevision:before.revision});await root.idle();expect(calls).toBe(0);expect((await host.getScreen('x'))!.text).toBe(edit);expect(errors).toHaveLength(1);
  const invalid=(await host.getScreen('x'))!;await host.setScreen('x',before.text,{expectedRevision:invalid.revision});await root.idle();await root.unmount();
});

test('Block local updates preserve metadata, CRLF and unrelated text; competing changes fail closed',()=>{
  const tree=(value:string)=>serializeTree(element('screen',{},[element('block',{id:'b',type:'raw',value})]));
  const before=tree('old'),next=tree('new');
  const disk=parseTextUI('notes\r\n~~~~textui id=b type=raw\r\nold\r\n~~~~\r\n<!-- note -->\r\n');
  expect(patchTree(disk,before,next)).toBe(disk.text.replace('old','new'));
  expect(()=>patchTree(parseTextUI(disk.text.replace('old','external')),before,next)).toThrow(/并发/);
  const unsafe=patchTree(disk,before,tree('~~~\n````\n~~~~'));expect(parseTextUI(unsafe).blocks.get('b')!.value).toBe('~~~\n````\n~~~~');expect(unsafe).toContain('notes\r\n');
});

test('interactive children in lists and quotes remain distinct from plain task Markdown',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];
  function App(){const [name]=useTextState('name','A');const [checked]=useTextState('checked',false);const [body]=useTextState('body','a\nb');return <Screen><List><ListItem><Input id="name" label="Name" value={name}/></ListItem><ListItem><Check id="checked" label="Check" checked={checked}/></ListItem></List><Quote><Block id="body" type="raw" value={body}/></Quote></Screen>;}
  const root=await render(<App/>,{host,screen:'x',onError:e=>errors.push(e)}),initial=(await host.getScreen('x'))!;
  await host.setScreen('x',initial.text.replace('[A]','[B]').replace('[ ]','[x]').replace('> a\n> b','> c\n> d'),{expectedRevision:initial.revision});await root.idle();expect(root.store.read('name')).toBe('B');expect(root.store.read('checked')).toBe(true);expect(root.store.read('body')).toBe('c\nd');expect(errors).toEqual([]);
  root.store.set('body','next\nline');await root.flush();expect((await host.getScreen('x'))!.text).toContain('> next\n> line');await root.unmount();
});

test('keyed interactive list additions, reorders and removals update structure while retaining stable IDs',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];
  const App=({ids}:{ids:string[]})=><Screen><Heading>Items</Heading><List>{ids.map(id=><ListItem key={id}><Check id={id} label={id} checked={false}/></ListItem>)}</List><Text>End</Text></Screen>;
  const root=await render(<App ids={['a','b']}/>,{host,screen:'x',onError:e=>errors.push(e)});
  const before=(await host.getScreen('x'))!;await host.setScreen('x','<!-- outside -->\n'+before.text,{expectedRevision:before.revision});await root.idle();
  await root.update(<App ids={['b','c','a']}/>);
  let text=(await host.getScreen('x'))!.text;expect([...parseTextUI(text).controls.keys()]).toEqual(['b','c','a']);expect(text).toContain('- [ ] c');expect(text).toContain('<!-- outside -->');expect(text).toContain('End');
  await root.update(<App ids={['c']}/>);text=(await host.getScreen('x'))!.text;expect([...parseTextUI(text).controls.keys()]).toEqual(['c']);expect(errors).toEqual([]);await root.unmount();
});

test('structural application updates reject a list containing new user text',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];
  const App=({ids}:{ids:string[]})=><List>{ids.map(id=><ListItem key={id}><Check id={id} label={id}/></ListItem>)}</List>;
  const root=await render(<App ids={['a','b']}/>,{host,screen:'x',onError:e=>errors.push(e)}),before=(await host.getScreen('x'))!;
  const edited=before.text.replace('\n- [ ] b','\n  user note\n- [ ] b');await host.setScreen('x',edited,{expectedRevision:before.revision});await root.idle();
  await expect(root.update(<App ids={['b','a']}/>)).rejects.toThrow(/安全更新结构/);expect((await host.getScreen('x'))!.text).toBe(edited);
  // Restore the confirmed document to finish the root cleanly.
  const disk=(await host.getScreen('x'))!;await host.setScreen('x',before.text,{expectedRevision:disk.revision});await root.idle();await root.unmount();
});


test('restoring the last confirmed bytes unblocks a failed Block transaction',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];const types=new BlockTypeRegistry();
  types.register('recover',{parse:text=>{if(text==='bad')throw new Error('invalid');return text;},serialize:String});
  function App(){const [value]=useTextState('b','good');return <Block id="b" type="recover" value={value}/>;}
  const root=await render(<App/>,{host,screen:'x',blockTypes:types,onError:e=>errors.push(e)}),initial=(await host.getScreen('x'))!;
  const invalid=await host.setScreen('x',initial.text.replace('good','bad'),{expectedRevision:initial.revision});await root.idle();
  await expect(root.flush()).rejects.toThrow(/事务尚未确认/);
  await host.setScreen('x',initial.text,{expectedRevision:invalid.revision});await root.idle();
  root.store.set('b','recovered');await root.flush();expect(parseTextUI((await host.getScreen('x'))!.text).blocks.get('b')!.value).toBe('recovered');expect(errors).toHaveLength(1);await root.unmount();
});

test('Block version races reject the application write and reconcile the newer external value',async()=>{
  const base=new MemoryScreen(),errors:Error[]=[];let release!:()=>void,pause=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const host:ScreenPort={getScreen:id=>base.getScreen(id),onScreenChange:(...args)=>base.onScreenChange(...args),async setScreen(id,text,options){if(pause)await gate;return base.setScreen(id,text,options);}};
  function App(){const [value]=useTextState('b','original');return <Block id="b" type="raw" value={value}/>;}
  const root=await render(<App/>,{host,screen:'x',onError:e=>errors.push(e)}),initial=(await base.getScreen('x'))!;
  pause=true;root.store.set('b','application');const flush=root.flush();await Promise.resolve();await Promise.resolve();
  await base.setScreen('x',initial.text.replace('original','editor'),{expectedRevision:initial.revision});release();
  await expect(flush).rejects.toThrow(/版本冲突/);await root.idle();expect(root.store.read('b')).toBe('editor');expect(parseTextUI((await base.getScreen('x'))!.text).blocks.get('b')!.value).toBe('editor');await root.unmount();
});

test('static updates never locate old headings inside editable Block bodies',()=>{
  const tree=(heading:string)=>serializeTree(element('screen',{},[element('heading',{},[{kind:'text',value:heading}]),element('block',{id:'b',type:'raw',value:'# Original'})]));
  const before=tree('Original'),next=tree('New');
  const disk=parseTextUI(before.text.replace(/^# Original/,'# User heading'));
  expect(()=>patchTree(disk,before,next)).toThrow(/普通 Markdown 内容已改变/);expect(disk.blocks.get('b')!.value).toBe('# Original');
  expect(parseTextUI(patchTree(parseTextUI(before.text),before,next)).blocks.get('b')!.value).toBe('# Original');
});
