import {constraintMetadata} from './validation.js';
import { encodeInput, ProtocolError, singleLine } from './schema.js';
import type { ParsedScreen, ControlValue, ProtocolOptions } from './schema.js';
import type { SerializedTree } from './serializer.js';
import {fencedCode} from './blocks.js';
import {parseTextUI} from './parser.js';

export function patchValues(document: ParsedScreen, updates: ReadonlyMap<string, ControlValue>, options: ProtocolOptions = {}): string {
  const edits = [...updates].map(([id, value]) => {
    const c = document.controls.get(id);
    if (!c) throw new ProtocolError(`未知控件：${id}`);
    if (typeof c.value !== typeof value) throw new ProtocolError(`控件值类型无效：${id}`);
    const replacement = (c.type === 'input' || c.type === 'number') ? `[${encodeInput(value as string, options)}]` : c.type === 'output' ? singleLine(String(value))
      : c.type === 'select' ? value ? '(*)' : '( )' : value ? '[x]' : '[ ]';
    return {start:c.start, end:c.end, replacement, changed:c.value !== value};
  }).filter(e => e.changed).sort((a,b) => b.start - a.start);
  let text = document.text;
  for (const e of edits) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  return text;
}
/** Three-way check for application writes; ordinary Markdown is never reserialized. */
export function patchTree(document: ParsedScreen, previous: SerializedTree | undefined, next: SerializedTree): string {
  const edits: {start:number; end:number; replacement:string}[] = [];
  const added: string[] = [];
  const covered=new Set<string>();
  if(previous)for(let index=0;index<Math.max(previous.structures.length,next.structures.length);index++) {
    const before=previous.structures[index],after=next.structures[index];
    const shape=(text:string)=>{
      const parsed=parseTextUI(text);
      const ranges=[...parsed.controls.values(),...parsed.blocks.values()].sort((a,b)=>b.start-a.start);
      for(const c of ranges)text=text.slice(0,c.start)+'<value>'+text.slice(c.end);
      return text;
    };
    if(before&&after&&shape(before.text)===shape(after.text))continue;
    for(const id of [...before?.ids??[],...after?.ids??[]])covered.add(id);
    if(!before){added.push(after!.text);continue;}
    // Compare against the previous structure with confirmed disk values substituted.
    // A user-added note or changed formatting prevents a structural rewrite.
    const fragment=parseTextUI(before.text);
    const registry=new Map([...fragment.controls].map(([id,c])=>{
      const disk=document.controls.get(id),old=previous.registry.get(id)!;
      if(!disk||disk.type!==old.type||disk.group!==old.group)throw new ProtocolError(`结构中的控件缺失或协议改变：${id}`);
      const desired=next.registry.get(id);
      if(desired&&disk.value!==old.value&&desired.value!==old.value&&desired.value!==disk.value&&c.type!=='action'&&c.type!=='output')throw new ProtocolError(`控件并发修改冲突：${id}`);
      return [id,{...old,value:disk.value}] as const;
    }));
    const blocks=new Map([...fragment.blocks].map(([id])=>{
      const disk=document.blocks.get(id),old=previous.blocks.get(id)!;
      if(!disk||disk.type!==old.type||disk.lang!==old.lang)throw new ProtocolError(`结构中的 Block 缺失或协议改变：${id}`);
      const desired=next.blocks.get(id);
      if(desired&&disk.value!==old.value&&desired.value!==old.value&&desired.value!==disk.value)throw new ProtocolError(`Block 并发修改冲突：${id}`);
      return [id,{...old,value:disk.value}] as const;
    }));
    const expected=patchTree(fragment,undefined,{text:before.text,registry,blocks,staticBlocks:[],structures:[]});
    const start=document.text.indexOf(expected);
    if(start<0||document.text.indexOf(expected,start+expected.length)>=0)throw new ProtocolError('列表或引用已被外部修改或存在歧义，无法安全更新结构。');
    for(const id of before.ids) {
      const disk=document.controls.get(id)??document.blocks.get(id)!;
      if(disk.fullStart<start||disk.fullEnd>start+expected.length)throw new ProtocolError('结构文本与已确认控件位置不一致，拒绝写入。');
    }
    edits.push({start,end:start+expected.length,replacement:after?.text??''});
  }
  for(const [id,b] of next.blocks) {
    if(covered.has(id))continue;
    const disk=document.blocks.get(id),old=previous?.blocks.get(id);
    if(!disk){if(!previous||old)throw new ProtocolError(`现有文件缺少 Block：${id}`);added.push(b.line);continue;}
    if(disk.type!==b.type||disk.lang!==b.lang)throw new ProtocolError(`Block 协议冲突：${id}`);
    if(old && disk.value!==old.value && b.value!==old.value && b.value!==disk.value)throw new ProtocolError(`Block 并发修改冲突：${id}`);
    if(constraintMetadata({...disk})!==constraintMetadata(b.props)){edits.push({start:disk.fullStart,end:disk.fullEnd,replacement:b.line.split('\n').map((line,index)=>(index?disk.prefix:'')+line).join('\n')});continue;}
    if(disk.value!==b.value) {
      // Reuse the user's fence and metadata unless the new body could close that fence.
      const unsafe=b.value.split(/\r?\n/).some(line=>new RegExp(`^ {0,3}${disk.fence[0]}{${disk.fence.length},}[ \\t]*$`).test(line));
      const replacement=unsafe?fencedCode(b.value,b.lang,`type=${b.type}${disk.explicitId?` id=${disk.explicitId}`:''}${constraintMetadata(b.props)}`).split('\n').map((line,index)=>(index?disk.prefix:'')+line).join('\n'):disk.opening+b.value.split('\n').map(line=>disk.prefix+line).join('\n')+(disk.closing.startsWith('\n')||disk.closing.startsWith('\r\n')?disk.closing:'\n'+disk.closing);
      edits.push({start:disk.fullStart,end:disk.fullEnd,replacement});
    }
  }
  for (const [id, c] of next.registry) {
    if(covered.has(id))continue;
    const disk = document.controls.get(id);
    if (!disk) {
      if (!previous || previous.registry.has(id)) throw new ProtocolError(`现有文件缺少控件：${id}；无法安全合并。`);
      added.push(c.line); continue;
    }
    if (disk.type !== c.type || disk.group !== c.group) throw new ProtocolError(`控件协议冲突：${id}`);
    const old = previous?.registry.get(id);
    if (old && disk.value !== old.value && c.value !== old.value && c.value !== disk.value && c.type !== 'action' && c.type !== 'output') throw new ProtocolError(`控件并发修改冲突：${id}`);
    if ((old && old.label !== c.label) || constraintMetadata({...disk})!==constraintMetadata(c.props)) {
      if (old && disk.label !== old.label && disk.label !== c.label) throw new ProtocolError(`控件标签并发修改：${id}`);
      edits.push({start:disk.fullStart,end:disk.fullEnd,replacement:c.line});
    } else if (disk.value !== c.value) {
      const replacement = (c.type === 'input' || c.type === 'number') ? `[${encodeInput(c.value as string)}]` : c.type === 'output' ? singleLine(String(c.value))
        : c.type === 'select' ? c.value ? '(*)' : '( )' : c.value ? '[x]' : '[ ]';
      edits.push({start:disk.start,end:disk.end,replacement});
    }
  }
  if (previous) {
    for(const [id] of previous.blocks)if(!covered.has(id)&&!next.blocks.has(id)){
      const disk=document.blocks.get(id);if(!disk)throw new ProtocolError(`待删除 Block 已在外部删除：${id}`);
      edits.push({start:disk.fullStart,end:disk.fullEnd,replacement:''});
    }
    for (const [id] of previous.registry) if (!covered.has(id)&&!next.registry.has(id)) {
      const disk = document.controls.get(id);
      if (!disk) throw new ProtocolError(`待删除控件已在外部删除：${id}`);
      edits.push({start:disk.fullStart,end:disk.fullEnd,replacement:''});
    }
    for (let index=0;index<Math.max(previous.staticBlocks.length,next.staticBlocks.length);index++) {
      const before=previous.staticBlocks[index], after=next.staticBlocks[index];
      if (before===after) continue;
      if (before===undefined) {added.push(after); continue;}
      const matches:number[]=[];
      const managed=[...document.controls.values(),...document.blocks.values()];
      for(let position=document.text.indexOf(before);position>=0;position=document.text.indexOf(before,position+before.length)) {
        if(!managed.some(c=>position<c.fullEnd&&position+before.length>c.fullStart))matches.push(position);
      }
      if(matches.length!==1)throw new ProtocolError('普通 Markdown 内容已改变或存在歧义，无法安全合并应用文本更新。');
      const start=matches[0];
      edits.push({start,end:start+before.length,replacement:after ?? ''});
    }
  }
  edits.sort((a,b)=>b.start-a.start);
  let text=document.text, boundary=text.length;
  for (const edit of edits) {
    if (edit.end>boundary) throw new ProtocolError('局部更新范围重叠，拒绝写入。');
    text=text.slice(0,edit.start)+edit.replacement+text.slice(edit.end); boundary=edit.start;
  }
  const newline=text.includes('\r\n')?'\r\n':'\n';
  if (added.length) text+=newline+added.join(newline+newline)+newline;
  return text;
}
