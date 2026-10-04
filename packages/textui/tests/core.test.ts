import {expect,test} from 'vitest';
import {MemoryScreen,ScreenConflictError,ScreenSession,parseTextUI,patchValues,semanticDiff,serialize,serializeTree,patchTree,identity,epochOf,stampText} from '@mineral/textui';
import type {ScreenChange,ScreenPort,ScreenSnapshot,ElementNode} from '@mineral/textui';

test('ScreenPort enforces create-only and update-only revisions, no-ops, immutable snapshots and unsubscribe',async()=>{
  const host=new MemoryScreen(),events:ScreenChange[]=[];
  const unsubscribe=await host.onScreenChange('home',event=>events.push(event));
  expect(await host.getScreen('home')).toBeNull();
  const first=await host.setScreen('home','A',{expectedRevision:null,origin:'author'});
  expect(events).toHaveLength(1);expect(events[0].origin).toBe('author');expect(Object.isFrozen(first)).toBe(true);
  await expect(host.setScreen('home','A',{expectedRevision:null})).rejects.toBeInstanceOf(ScreenConflictError);
  expect(await host.setScreen('home','A',{expectedRevision:first.revision})).toEqual(first);expect(events).toHaveLength(1);
  const second=await host.setScreen('home','B',{expectedRevision:first.revision});
  await expect(host.setScreen('home','C',{expectedRevision:first.revision})).rejects.toBeInstanceOf(ScreenConflictError);
  const third=await host.setScreen('home','A',{expectedRevision:second.revision});expect(third.revision).not.toBe(first.revision);
  unsubscribe();await host.setScreen('home','D',{expectedRevision:third.revision});expect(events).toHaveLength(3);
  await expect(host.setScreen('missing','bad',{} as never)).rejects.toThrow(/必填/);
});

test('CAS races permit exactly one writer and listener failures do not undo committed bytes',async()=>{
  const errors:unknown[]=[];const host=new MemoryScreen(error=>errors.push(error));
  await host.onScreenChange('x',()=>{throw new Error('subscriber');});
  const initial=await host.setScreen('x','A',{expectedRevision:null});
  const results=await Promise.allSettled(['B','C'].map(text=>host.setScreen('x',text,{expectedRevision:initial.revision})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(errors).toHaveLength(2);expect((await host.getScreen('x'))!.text).not.toBe('A');
});

test('parser and localized serializer preserve ranges, source formatting, inline controls and code exclusions',()=>{
  const text='## 用户笔记\r\nCount: 7 <!-- textui:type=output id=count --> [ ] Go <!-- textui:id=go type=action -->\r\nName: [a\\]b\\\\c] <!-- textui:type=input -->\r\n```md\n- [x] fake <!-- textui:id=go type=action -->\n```\n';
  const doc=parseTextUI(text);expect(doc.controls.size).toBe(3);expect(patchValues(doc,new Map())).toBe(text);
  expect(doc.controls.get(identity('input','Name'))!.value).toBe('a]b\\c');
  expect(patchValues(doc,new Map([['count','8']]))).toBe(text.replace('Count: 7','Count: 8'));
  expect(()=>parseTextUI('- [ ] X <!-- textui:type=action -->\n- [ ] X <!-- textui:type=action -->')).toThrow(/歧义/);
});

test('core serialization and semantic events are independent of React',()=>{
  const root:ElementNode={kind:'element',type:'screen',props:{},children:[{kind:'element',type:'heading',props:{level:1},children:[{kind:'text',value:'User'}]},{kind:'element',type:'check',props:{id:'sound',label:'Sound',checked:true},children:[]}]};
  const text=serialize(root),before=parseTextUI(text);
  expect(text).toContain('# User');expect(semanticDiff(before,parseTextUI(patchValues(before,new Map([['sound',false]]))))).toEqual([{type:'change',target:'sound',before:true,after:false}]);
  expect(()=>parseTextUI('Name: [bad\\n] <!-- textui:type=input -->')).toThrow(/单行/);
  const encoded='Name: [line\\nnext] <!-- textui:type=input -->';expect(parseTextUI(encoded,{allowEscapedNewlines:true}).controls.values().next().value!.value).toBe('line\nnext');
});

test('subscribe-before-read reconciles changes made during async subscription initialization',async()=>{
  const base=new MemoryScreen();await base.setScreen('x','old',{expectedRevision:null});
  let subscribed=false;
  const port:ScreenPort={getScreen:id=>base.getScreen(id),setScreen:(...args)=>base.setScreen(...args),async onScreenChange(id,listener){const stop=await base.onScreenChange(id,listener);const current=(await base.getScreen(id))!;await base.setScreen(id,'latest',{expectedRevision:current.revision});subscribed=true;return stop;}};
  const session=new ScreenSession(port,'x',()=>{});
  let startup:ScreenSnapshot|null=null;
  await session.start(async snapshot=>{expect(subscribed).toBe(true);startup=snapshot;},async()=>{});
  expect((startup as ScreenSnapshot|null)?.text).toBe('latest');await session.close();
});

test('late/duplicate notifications are resolved against the latest snapshot, not revision ordering or origin alone',async()=>{
  const base=new MemoryScreen();const initial=await base.setScreen('x','A',{expectedRevision:null});
  let notify!:(event:ScreenChange)=>void;const seen:string[]=[];
  const port:ScreenPort={getScreen:id=>base.getScreen(id),setScreen:(...args)=>base.setScreen(...args),async onScreenChange(_id,listener){notify=listener;return()=>{};}};
  const session=new ScreenSession(port,'x',error=>{throw error;});
  await session.start(async()=>{},async snapshot=>{seen.push(snapshot.text);await session.commit(snapshot,snapshot.text);});
  const latest=await base.setScreen('x','B',{expectedRevision:initial.revision});
  notify({before:initial,after:latest,origin:session.origin});notify({before:latest,after:initial,origin:'stale'});
  await session.idle();expect(seen).toEqual(['B']);expect(session.snapshot!.revision).toBe(latest.revision);await session.close();
});

test('acknowledgement epoch makes repeated fresh Action requests distinguishable without Node crypto',()=>{
  const request='- [x] Go <!-- textui:id=go type=action -->\r\n<!-- ordinary -->\r\n<!-- textui:epoch=7 -->\r\n';
  const acknowledged=stampText(request.replace('[x]','[ ]'),request);
  expect(epochOf(acknowledged)).toBe(8);expect(acknowledged).toContain('<!-- ordinary -->\r\n');
  const fresh=patchValues(parseTextUI(acknowledged),new Map([['go',true]]));
  expect(fresh).not.toBe(request);expect(stampText(acknowledged,acknowledged)).toBe(acknowledged);
});

test('parser accepts attribute order and escaped values, rejects ambiguity, invalid values and code examples', () => {
  const markdown='```md\n- [ ] fake <!-- textui:type=action -->\n```\n`<!-- textui:type=bad -->`\nName: [a\\]b\\\\c] <!-- textui:type=input id=name -->\n';
  const doc=parseTextUI(markdown); expect(doc.controls.size).toBe(1); expect(doc.controls.get('name')!.value).toBe('a]b\\c');
  expect(patchValues(doc,new Map())).toBe(markdown);
  expect(()=>parseTextUI('- [ ] A <!-- textui:type=action -->\n- [ ] A <!-- textui:type=action -->')).toThrow(/歧义/);
  expect(()=>parseTextUI('- [ ] A <!-- textui:id=x type=check -->\n- [ ] B <!-- textui:type=action id=x -->')).toThrow(/重复/);
  expect(()=>parseTextUI('Name: [a\\n] <!-- textui:type=input -->')).toThrow(/单行/);
  expect(()=>parseTextUI('- [y] A <!-- textui:type=check -->')).toThrow(/无效/);
  expect(()=>parseTextUI('Name: [a] <!-- textui:type=input')).toThrow(/未闭合/);
});

test('ambiguous selection batches and serializer identities are rejected before dispatch', () => {
  const text='(*) A <!-- textui:type=select group=t -->\n( ) B <!-- textui:type=select group=t -->\n( ) C <!-- textui:type=select group=t -->';
  const before=parseTextUI(text), ids=[...before.controls.keys()];
  const after=parseTextUI(patchValues(before,new Map([[ids[1],true],[ids[2],true]])));
  expect(()=>semanticDiff(before,after)).toThrow(/同时新选/);
  expect(()=>semanticDiff(before,parseTextUI(patchValues(before,new Map([[ids[0],false]]))))).toThrow(/不能直接清空/);
  const duplicate:ElementNode={kind:'element',type:'screen',props:{},children:[1,2].map(()=>({kind:'element',type:'action',props:{label:'Submit'},children:[]}))};
  expect(()=>serializeTree(duplicate)).toThrow(/歧义/);
  const emptySelect:ElementNode={kind:'element',type:'select',props:{group:'t',value:null,options:[{label:'A',value:'a'}]},children:[]};
  const parsed=parseTextUI(serializeTree(emptySelect).text); expect(semanticDiff(parsed,parsed)).toEqual([]);
});

test('three-way patches reject competing value changes and preserve external Markdown exactly', () => {
  const node=(value:string):ElementNode=>({kind:'element',type:'screen',props:{},children:[{kind:'element',type:'input',props:{id:'n',label:'Name',value},children:[]}]});
  const before=serializeTree(node('A')), after=serializeTree(node('B'));
  const disk=parseTextUI('## My title\r\nName: [C] <!-- textui:type=input id=n -->\r\n<!-- note -->\r\n');
  expect(()=>patchTree(disk,before,after)).toThrow(/并发修改/);
  const safe=parseTextUI(disk.text.replace('[C]','[A]'));
  expect(patchTree(safe,before,after)).toBe(safe.text.replace('[A]','[B]'));
});
