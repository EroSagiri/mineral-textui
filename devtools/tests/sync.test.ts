import {afterEach,describe,expect,it,vi} from 'vitest';
import {MemoryScreen,ScreenConflictError} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,ScreenWriteOptions,ScreenChange} from '@mineral/textui';
import {textDiff,applyPatches} from '../src/editor/diff.ts';
import {mergeText} from '../src/editor/merge.ts';
import {EditorSync} from '../src/editor/sync.ts';

const sessions:EditorSync[]=[];
afterEach(async()=>{for(const s of sessions)await s.close();sessions.length=0;vi.useRealTimers();});
async function fixture(text='Name: June\nProgress: 0%\nNotes: empty\n',port:ScreenPort=new MemoryScreen()){
  await port.setScreen('test',text,{expectedRevision:null});
  const apply=vi.fn();const sync=new EditorSync(port,'test',apply,()=>{},()=>{},500);sessions.push(sync);await sync.start();return {port,sync,apply,text};
}
async function external(port:ScreenPort,text:string){const snapshot=(await port.getScreen('test'))!;return port.setScreen('test',text,{expectedRevision:snapshot.revision});}
describe('local diff and merge',()=>{
  it('keeps unchanged middle text and uses UTF-16 offsets',()=>{
    const before='😀 Start\nUNCHANGED\nEnd',after='😀 Begin\nUNCHANGED\nFinish';
    const patches=textDiff(before,after);expect(patches.length).toBeGreaterThan(1);expect(applyPatches(before,patches)).toBe(after);
    expect(patches.every(p=>!(p.from<10 && p.to>20))).toBe(true);
  });
  it('merges separate changes but preserves local on overlap',()=>{
    expect(mergeText('abc\ndef','ABC\ndef','abc\nDEF')).toEqual({text:'ABC\nDEF',conflict:false});
    expect(mergeText('Name: June','Name: Alex','Name: Mary')).toEqual({text:'Name: Alex',conflict:true});
  });
  it('accepts identical changes and rejects ambiguous boundary insertions',()=>{
    expect(mergeText('abc','aXc','aXc').conflict).toBe(false);
    expect(mergeText('abc','aXbc','aYbc').conflict).toBe(true);
    expect(mergeText('abc','Xbc','a!bc').conflict).toBe(true);
  });
});
describe('editor synchronization',()=>{
  it('debounces fast inputs without saving itself in a loop',async()=>{
    vi.useFakeTimers();const {sync,port}=await fixture();const spy=vi.spyOn(port,'setScreen');
    sync.edit('one');await vi.advanceTimersByTimeAsync(300);sync.edit('two');await vi.advanceTimersByTimeAsync(499);expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await sync.flush();expect(spy).toHaveBeenCalledTimes(1);expect(sync.info.status).toBe('Saved');
    await vi.advanceTimersByTimeAsync(2000);expect(spy).toHaveBeenCalledTimes(1);
  });
  it('merges remote updates into unsaved local changes',async()=>{
    const {sync,port,text}=await fixture();sync.edit(text.replace('June','Alex'));
    await external(port,text.replace('0%','50%'));await sync.refresh();
    expect(sync.info.localText).toContain('Alex');expect(sync.info.localText).toContain('50%');expect(await sync.flush()).toBe(true);
  });
  it('stops on conflicting edits and resolves against fresh remote',async()=>{
    const {sync,port,text}=await fixture();sync.edit(text.replace('June','Alex'));
    await external(port,text.replace('June','Mary'));await sync.refresh();expect(sync.info.status).toBe('Conflict');expect(await sync.flush()).toBe(false);
    await external(port,text.replace('June','Mary').replace('0%','70%'));await sync.resolve('remote');expect(sync.info.localText).toContain('70%');expect(sync.info.status).toBe('Saved');
  });
  it('can adopt local and manual conflict results without silent overwrite',async()=>{
    const {sync,port,text}=await fixture();sync.edit(text.replace('June','Alex'));await external(port,text.replace('June','Mary'));await sync.refresh();
    await sync.resolve('manual',text.replace('June','Both'));expect(await sync.flush()).toBe(true);expect((await port.getScreen('test'))!.text).toContain('Both');
  });
  it('defers remote replacement and autosave during composition',async()=>{
    vi.useFakeTimers();const {sync,port,text,apply}=await fixture();apply.mockClear();sync.composition(true);sync.edit(text.replace('June','中文'));
    await external(port,text.replace('0%','10%'));await sync.refresh();await vi.advanceTimersByTimeAsync(1000);
    expect(apply).not.toHaveBeenCalled();expect(sync.info.saves).toBe(0);
    sync.composition(false);expect(sync.info.localText).toContain('中文');expect(sync.info.localText).toContain('10%');expect(await sync.flush()).toBe(true);
  });
  it('preserves edits entered while save is pending',async()=>{
    const memory=new MemoryScreen();let release!:()=>void,entered!:()=>void;
    const waiting=new Promise<void>(resolve=>{entered=resolve;});let pause=false;
    const port:ScreenPort={getScreen:id=>memory.getScreen(id),onScreenChange:(id,listener)=>memory.onScreenChange(id,listener),async setScreen(id,text,options){if(pause){pause=false;entered();await new Promise<void>(resolve=>{release=resolve;});}return memory.setScreen(id,text,options);}};
    const {sync}=await fixture('original',port);pause=true;sync.edit('first');const saving=sync.save();await waiting;sync.edit('second');release();await saving;
    expect(sync.info.localText).toBe('second');expect(await sync.flush()).toBe(true);expect((await port.getScreen('test'))!.text).toBe('second');
  });
  it('retains inputs on failure and retries explicitly',async()=>{
    const {sync,port}=await fixture();const original=port.setScreen.bind(port);vi.spyOn(port,'setScreen').mockRejectedValueOnce(new Error('offline'));
    sync.edit('unsaved');await sync.save();expect(sync.info.status).toBe('Disconnected');expect(sync.info.localText).toBe('unsaved');expect(await sync.flush()).toBe(false);
    port.setScreen=original;await sync.retry();expect(sync.info.status).toBe('Saved');
  });
  it('rereads and merges on CAS conflict',async()=>{
    const {sync,port,text}=await fixture();sync.edit(text.replace('June','Alex'));
    const original=port.setScreen.bind(port);let once=true;
    port.setScreen=async(id,content,options)=>{if(once){once=false;const latest=await external({getScreen:port.getScreen.bind(port),setScreen:original,onScreenChange:port.onScreenChange.bind(port)},text.replace('0%','80%'));throw new ScreenConflictError(id,options.expectedRevision,latest.revision);}return original(id,content,options);};
    await sync.save();expect(sync.info.localText).toContain('Alex');expect(sync.info.localText).toContain('80%');expect(await sync.flush()).toBe(true);
  });
  it('subscribes before reading and does not order opaque revisions',async()=>{
    let listener!: (change:ScreenChange)=>void;let read=0;
    const port:ScreenPort={async onScreenChange(_id,notify){listener=notify;return ()=>{};},async getScreen(id){expect(listener).toBeDefined();read++;if(read===1){listener({before:{id,text:'',revision:''},after:{id,text:'new',revision:'aaa'}});return {id,text:'old',revision:'zzz'};}return {id,text:'new',revision:'aaa'};},async setScreen(id,text,_options:ScreenWriteOptions):Promise<ScreenSnapshot>{return {id,text,revision:'bbb'};}};
    const sync=new EditorSync(port,'test',()=>{},()=>{},()=>{});sessions.push(sync);await sync.start();await sync.refresh();expect(sync.info.localText).toBe('new');expect(sync.info.base!.revision).toBe('aaa');
  });
  it('drains pending save before close and cancels future debounce',async()=>{
    vi.useFakeTimers();const {sync}=await fixture();sync.edit('saved');expect(await sync.flush()).toBe(true);await sync.close();await vi.advanceTimersByTimeAsync(1000);expect(sync.info.saves).toBe(1);
  });
});
