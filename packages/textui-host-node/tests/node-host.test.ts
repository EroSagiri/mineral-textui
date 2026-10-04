import {expect,test} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,renameSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createNodeHost} from '@mineral/textui-host-node';
import {ScreenConflictError} from '@mineral/textui';
import type {ScreenChange} from '@mineral/textui';
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await delay(10);}throw new Error('监听超时');}

test('Node Host creates files, sends origin, ignores duplicate saves and tracks ordinary/atomic external edits',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'textui-node-')),errors:unknown[]=[],events:ScreenChange[]=[];
  const host=createNodeHost(dir,{onError:e=>errors.push(e)});
  try {
    const off=await host.onScreenChange('home',event=>events.push(event));expect(await host.getScreen('home')).toBeNull();
    const first=await host.setScreen('home','A',{expectedRevision:null,origin:'app'});
    expect(readFileSync(host.filePath('home'),'utf8')).toBe('A');expect(events[0].origin).toBe('app');
    await host.setScreen('home','A',{expectedRevision:first.revision});writeFileSync(host.filePath('home'),'A');await delay(100);expect(events).toHaveLength(1);
    writeFileSync(host.filePath('home'),'B');await until(()=>events.length===2);expect(events[1].before).toEqual(first);expect(events[1].after.text).toBe('B');
    const temp=join(dir,'replacement.md');writeFileSync(temp,'C');renameSync(temp,host.filePath('home'));await until(()=>events.length===3);
    writeFileSync(host.filePath('home'),'D');await until(()=>events.length===4);expect(events[3].after.text).toBe('D');
    expect(errors).toEqual([]);off();writeFileSync(host.filePath('home'),'E');await delay(100);expect(events).toHaveLength(4);
  }finally{await host.close();rmSync(dir,{recursive:true,force:true});}
});

test('old snapshots cannot overwrite unprocessed edits; create races and missing expected revisions fail',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'textui-stale-')),host=createNodeHost(dir);
  try {
    const first=await host.setScreen('screen','# 原文\n',{expectedRevision:null});
    const external='# 原文\n\n外部新内容\n';writeFileSync(host.filePath('screen'),external);
    await expect(host.setScreen('screen','# 引擎输出\n',{expectedRevision:first.revision})).rejects.toBeInstanceOf(ScreenConflictError);
    expect(readFileSync(host.filePath('screen'),'utf8')).toBe(external);
    await expect(host.setScreen('screen','bad',{expectedRevision:null})).rejects.toBeInstanceOf(ScreenConflictError);
    await expect(host.setScreen('screen','bad',{} as never)).rejects.toThrow(/必填/);
    expect(readdirSync(dir)).toEqual(['screen.md']);
  }finally{await host.close();rmSync(dir,{recursive:true,force:true});}
});

test('listener failures do not fail committed writes, and path traversal is rejected',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'textui-listener-')),errors:unknown[]=[],host=createNodeHost(dir,{onError:e=>errors.push(e)});
  try {
    await host.onScreenChange('x',()=>{throw new Error('subscriber');});await expect(host.setScreen('x','A',{expectedRevision:null})).resolves.toMatchObject({text:'A'});expect(errors).toHaveLength(1);
    for(const id of ['../outside','..','a/b','a\\b','CON'])await expect(host.getScreen(id)).rejects.toThrow(/无效/);
  }finally{await host.close();rmSync(dir,{recursive:true,force:true});}
});
