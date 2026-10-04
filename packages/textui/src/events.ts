import {assertEditable} from './validation.js';
import { ProtocolError } from './schema.js';
import type { ParsedScreen, ProtocolOptions } from './schema.js';
import {blockTypes, type BlockTypeRegistry} from './blocks.js';
export type UIEvent =
  | {type: 'change'; target: string; before: string | boolean; after: string | boolean}
  | {type: 'select'; target: string; group: string; before: string | null; after: string | null}
  | {type: 'trigger'; target: string}
  | {type: 'textChange'; target: string; before: string; after: string}
  | {type: 'blockEvent'; target: string; event: unknown};

/** Document order; a group switch emits one event at the newly selected option. */
export function semanticDiff(before: ParsedScreen, after: ParsedScreen, options: ProtocolOptions = {}, types:BlockTypeRegistry = blockTypes): UIEvent[] {
  const events: UIEvent[] = [];
  const changedGroups = new Set<string>();
  for (const control of after.controls.values()) {
    const old = before.controls.get(control.id);
    if (!old) {
      if (control.type === 'action' && control.value) throw new ProtocolError('新增 Action 必须保持未勾选。');
      continue;
    }
    if (old.type !== control.type || old.group !== control.group) throw new ProtocolError(`控件类型或分组改变：${control.id}`);
    if (control.type === 'output') continue;
    if (old.value === control.value) {assertEditable(control.id,old,control,control.start,control.end,false);continue;}
    assertEditable(control.id,old,control,control.start,control.end);
    if (control.type === 'input' || control.type === 'number' || control.type === 'check') events.push({type:'change', target:control.id, before:old.value, after:control.value});
    if (control.type === 'action' && control.value) events.push({type:'trigger', target:control.id});
    if (control.type === 'select' && control.value) {
      if (changedGroups.has(control.group!)) throw new ProtocolError(`分组 ${control.group} 同时新选多个选项。`);
      changedGroups.add(control.group!);
      const previous = [...before.controls.values()].find(c => c.type === 'select' && c.group === control.group && c.value);
      events.push({type:'select', target:control.id, group:control.group!, before:previous?.id ?? null, after:control.id});
    }
  }
  for (const old of before.controls.values()) {
    if (!after.controls.has(old.id)) throw new ProtocolError(`受管理控件被删除或身份改变：${old.id}`);
  }
  for (const group of new Set([...after.controls.values()].filter(c => c.type === 'select').map(c => c.group!))) {
    const chosen = [...after.controls.values()].filter(c => c.group === group && c.value);
    if (chosen.length === 0) {
      const old=[...before.controls.values()].find(c => c.group === group && c.value);
      if (old && !options.allowEmptySelection) throw new ProtocolError(`分组 ${group} 需要选择替代选项，不能直接清空已确认选择。`);
      if (old) events.push({type:'select',target:old.id,group,before:old.id,after:null});
    }
    if (chosen.length > 1 && !changedGroups.has(group)) throw new ProtocolError(`分组 ${group} 存在多个选中项。`);
  }
  for(const block of after.blocks.values()) {
    const old=before.blocks.get(block.id);
    if(!old)continue;
    if(old.type!==block.type || old.lang!==block.lang)throw new ProtocolError(`Block 类型或语言改变：${block.id}`);
    if(old.value===block.value){assertEditable(block.id,old,block,block.start,block.end,false);continue;}
    assertEditable(block.id,old,block,block.start,block.end);
    events.push({type:'textChange',target:block.id,before:old.value,after:block.value});
    const codec=types.get(block.type);
    if(codec){const previous=codec.parse(old.value),next=codec.parse(block.value);for(const event of codec.deriveEvents?.(previous,next)??[])events.push({type:'blockEvent',target:block.id,event});}
  }
  for(const old of before.blocks.values())if(!after.blocks.has(old.id))throw new ProtocolError(`受管理 Block 被删除或身份改变：${old.id}`);
  const order=new Map([...after.controls.values(),...after.blocks.values()].map(c=>[c.id,c.fullStart]));
  return events.sort((a,b)=>order.get(a.target)!-order.get(b.target)!);
}
