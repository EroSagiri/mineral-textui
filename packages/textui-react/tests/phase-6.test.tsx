import {useState} from 'react';
import {expect,test} from 'vitest';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {MemoryScreen,parseNumberText,validateField,parseTextUI,semanticDiff,serializeTree,patchTree,FieldValidationException} from '@mineral/textui';
import {render,Text,Strong,Emphasis,Strike,Link,Code,Input,Textarea,NumberInput,Action,Check,useTextState} from '@mineral/textui-react';
import {verifyPhase6} from '../../../tests/phase-6-probe.tsx';
test('Phase 6 portable transaction, persistence and constraint contract',async()=>{expect(await verifyPhase6()).toMatchObject({ok:true});});
test('strict decimal grammar, empty values, ranges and tolerant steps',()=>{
  for(const [text,value] of [['0',0],['-2',-2],['.25',0.25],['1e2',100],['',null]] as const)expect(parseNumberText(text)).toBe(value);
  for(const text of ['NaN','Infinity','12abc','0x12',' ','1,2','1e999'])expect(()=>parseNumberText(text)).toThrow();
  expect(validateField(0.3,{step:0.1}).valid).toBe(true);expect(validateField(-0.2,{min:-0.3,step:0.1}).valid).toBe(true);
  expect(validateField(0.31,{step:0.1}).valid).toBe(false);expect(validateField(0,{min:0,max:0}).valid).toBe(true);
  expect(validateField('',{required:true},'edit').valid).toBe(true);expect(validateField(' ',{required:true}).valid).toBe(false);expect(validateField(false,{required:true}).valid).toBe(false);expect(validateField(false,{required:true},'edit').valid).toBe(true);
});
test('inline formats escape literals, nest with links and code, keep legacy Text raw and render repeatedly',async()=>{
  const host=new MemoryScreen();const app=<Text>**legacy** <Strong>中 * [x] <Emphasis>nested</Emphasis> <Link href="https://example.com"><Code>{'x`y'}</Code></Link><Strong>same</Strong></Strong><Strike>old</Strike><Strong>{''}</Strong></Text>;
  const root=await render(app,{host,screen:'x'});const saved=(await host.getScreen('x'))!;
  expect(saved.text).toContain('**legacy**');expect(saved.text).toContain(String.raw`中 \* \[x\]`);expect(saved.text).toContain('*nested*');
  const ast=fromMarkdown(saved.text);const paragraph=(ast.children[0] as any).children;expect(paragraph.filter((n:any)=>n.type==='strong')).toHaveLength(2);
  await root.update(app);expect((await host.getScreen('x'))!.revision).toBe(saved.revision);await root.unmount();
});
test('metadata booleans and numeric constraints reject malformed values',()=>{
  for(const attrs of ['disabled=yes','required=1','step=0','min=NaN','min=2 max=1'])expect(()=>parseTextUI(`N: [1] <!-- textui:type=number ${attrs} -->`)).toThrow();
  expect(parseTextUI('N: [1] <!-- textui:type=number disabled=false min=-1 step=1e-2 -->').controls.values().next().value).toMatchObject({disabled:false,min:-1,step:0.01});
});
test('textarea malformed and prematurely closed fences fail explicitly',()=>{
  expect(()=>parseTextUI('```textui type=textarea id=t\na')).toThrow(/围栏/);
  expect(()=>parseTextUI('```textui type=textarea id=t\na\n```\nrest\n```')).toThrow(/围栏/);
  expect(parseTextUI('```textui type=textarea id=t\na\n```\n\n> ```\n> plain\n> ```').blocks.get('t')!.value).toBe('a');
});
test('React toggles constraints locally; core rejects tampered metadata with unchanged values',async()=>{
  const host=new MemoryScreen();const app=(disabled:boolean)=><Action id="a" label="A" disabled={disabled}/>;
  const root=await render(app(false),{host,screen:'x'});await root.update(app(true));const saved=(await host.getScreen('x'))!;
  expect(saved.text).toContain('disabled=true');expect(()=>semanticDiff(parseTextUI(saved.text),parseTextUI(saved.text.replace('disabled=true','disabled=false')))).toThrow(FieldValidationException);await root.unmount();
});
test('restored same-batch state cannot enable an Action forbidden by the resulting application state',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];let calls=0;
  function App(){const [enabled]=useTextState('enabled',true);return <><Check id="enabled" label="Enabled" checked={enabled}/><Action id="go" label="Go" disabled={!enabled} onTrigger={()=>calls++}/></>;}
  const root=await render(<App/>,{host,screen:'x',onError:e=>errors.push(e)}),saved=(await host.getScreen('x'))!;
  const text=saved.text.replace('- [x] Enabled','- [ ] Enabled').replace('- [ ] Go','- [x] Go');await host.setScreen('x',text,{expectedRevision:saved.revision});await root.idle();
  expect(calls).toBe(0);expect(root.store.read('enabled')).toBe(true);expect(errors[0]).toBeInstanceOf(FieldValidationException);expect((await host.getScreen('x'))!.text).toBe(text);await root.unmount();
});

test('Textarea and NumberInput writes use CAS and preserve newer simultaneous editor state',async()=>{
  const base=new MemoryScreen(),errors:Error[]=[];let release!:()=>void,pause=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const host:import('@mineral/textui').ScreenPort={getScreen:id=>base.getScreen(id),onScreenChange:(...args)=>base.onScreenChange(...args),async setScreen(id,text,options){if(pause)await gate;return base.setScreen(id,text,options);}};
  function App(){const [text]=useTextState('t','original');const [n]=useTextState<number|null>('n',1);return <><Textarea id="t" value={text}/><NumberInput id="n" label="N" value={n}/></>;}
  const root=await render(<App/>,{host,screen:'x',onError:e=>errors.push(e)}),initial=(await base.getScreen('x'))!;
  pause=true;root.store.set('t','application');root.store.set('n',2);const flush=root.flush();await Promise.resolve();await Promise.resolve();
  await base.setScreen('x','note\n'+initial.text.replace('original','editor').replace('[1]','[3]'),{expectedRevision:initial.revision});release();
  await expect(flush).rejects.toThrow(/版本冲突/);await root.idle();expect(root.store.read('t')).toBe('editor');expect(root.store.read('n')).toBe(3);expect((await base.getScreen('x'))!.text).toContain('note');await root.unmount();
});
test('textarea CRLF and local fence growth preserve unrelated bytes and constraints',()=>{
  const tree=(value:string)=>serializeTree({kind:'element',type:'screen',props:{},children:[{kind:'element',type:'textarea',props:{id:'t',value,readOnly:true},children:[]}]});
  const before=tree('old'),next=tree('new\n```\n'),disk=parseTextUI('notes\r\n```textui id=t type=textarea readOnly=true\r\nold\r\n```\r\nend\r\n');
  const updated=patchTree(disk,before,next);expect(updated.startsWith('notes\r\n')).toBe(true);expect(updated.endsWith('end\r\n')).toBe(true);expect(parseTextUI(updated).blocks.get('t')).toMatchObject({value:'new\n```\n',readOnly:true});
});

test('adjacent declarative formats coalesce without producing literal delimiter runs',async()=>{
  const host=new MemoryScreen();const root=await render(<Text><Strong>A</Strong><Strong>B</Strong><Emphasis>C</Emphasis><Emphasis>D</Emphasis></Text>,{host,screen:'x'});
  const text=(await host.getScreen('x'))!.text;expect(text).toBe('**AB***CD*\n');const children=(fromMarkdown(text).children[0] as any).children;
  expect(children.map((n:any)=>[n.type,n.children[0].value])).toEqual([['strong','AB'],['emphasis','CD']]);await root.unmount();
});

test('new controlled components support local React state and explicit persistent state keys',async()=>{
  const host=new MemoryScreen(),errors:Error[]=[];let received:number|null=0;
  function App(){const [body,setBody]=useState('A');const [n,setN]=useState<number|null>(1);const [persisted]=useTextState('saved-key','persisted');return <><Textarea id="body" value={body} onChange={e=>setBody(e.after)}/><NumberInput id="num" label="N" value={n} onValueChange={v=>{received=v;setN(v);}}/><Textarea id="saved" stateKey="saved-key" value={persisted}/></>;}
  const root=await render(<App/>,{host,screen:'x',onError:e=>errors.push(e)}),first=(await host.getScreen('x'))!;
  await host.setScreen('x',first.text.replace('\nA\n','\nB\n').replace('[1]','[2.5]').replace('\npersisted\n','\nrestored\n'),{expectedRevision:first.revision});await root.idle();
  expect(received).toBe(2.5);expect(parseTextUI((await host.getScreen('x'))!.text).blocks.get('body')!.value).toBe('B');expect(root.store.read('saved-key')).toBe('restored');expect(errors).toEqual([]);await root.unmount();
});
test.each(['disabled','readOnly'] as const)('%s rejects external edits of both new fields',async flag=>{
  const host=new MemoryScreen(),errors:Error[]=[];let calls=0;
  const root=await render(<><Textarea id="t" value="old" {...{[flag]:true}} onChange={()=>calls++}/><NumberInput id="n" label="N" value={1} {...{[flag]:true}} onValueChange={()=>calls++}/></>,{host,screen:'x',onError:e=>errors.push(e)});
  const first=(await host.getScreen('x'))!;
  for(const text of [first.text.replace('\nold\n','\nnew\n'),first.text.replace('[1]','[2]')]){const saved=(await host.getScreen('x'))!;await host.setScreen('x',text,{expectedRevision:saved.revision});await root.idle();expect(calls).toBe(0);expect((await host.getScreen('x'))!.text).toBe(text);const failed=(await host.getScreen('x'))!;await host.setScreen('x',first.text,{expectedRevision:failed.revision});await root.idle();}
  expect(errors).toHaveLength(2);expect(errors.every(e=>e instanceof FieldValidationException)).toBe(true);await root.unmount();
});
