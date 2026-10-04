import {parseTextUI,patchValues,fencedCode} from '@mineral/textui';
import type {ControlValue} from '@mineral/textui';
export interface PreviewEdit {id:string;value:ControlValue}
export interface TextEdit {from:number;to:number;insert:string}
/** Pure developer-tool protocol: never invokes the application's event handlers. */
export function previewPatches(text:string,edit:PreviewEdit):TextEdit[]{
  const parsed=parseTextUI(text),control=parsed.controls.get(edit.id),block=parsed.blocks.get(edit.id);
  if(block){
    if(block.disabled || block.readOnly || typeof edit.value!=='string')return [];
    if(block.value===edit.value)return [];
    const newline=text.includes('\r\n')?'\r\n':'\n';
    const unsafe=edit.value.split(/\r?\n/).some(line=>new RegExp(`^ {0,3}${block.fence[0]}{${block.fence.length},}[ \\t]*$`).test(line));
    const meta=block.opening.slice(block.fence.length+block.lang.length).trim();
    const insert=unsafe?fencedCode(edit.value,block.lang,meta).split('\n').map((line,i)=>(i?block.prefix:'')+line).join(newline)
      :block.opening+edit.value.split(/\r?\n/).map(line=>block.prefix+line).join(newline)+(block.closing.startsWith('\n')||block.closing.startsWith('\r\n')?block.closing:newline+block.closing);
    return [{from:block.fullStart,to:block.fullEnd,insert}];
  }
  if(!control || control.disabled || control.readOnly || control.type==='output')return [];
  if(control.type==='action' && (control.value || edit.value!==true))return [];
  if(control.type==='select' && edit.value!==true)return [];
  const updates=new Map<string,ControlValue>([[edit.id,edit.value]]);
  if(control.type==='select')for(const peer of parsed.controls.values())if(peer.type==='select' && peer.group===control.group && peer.id!==control.id){
    if(peer.value && (peer.disabled || peer.readOnly))return [];
    updates.set(peer.id,false);
  }
  // patchValues handles protocol escaping; extract only the managed token changes.
  const patches:TextEdit[]=[];
  for(const [id,value] of updates){
    const c=parsed.controls.get(id)!;
    if(c.value===value)continue;
    const updated=patchValues(parsed,new Map([[id,value]]));
    patches.push({from:c.start,to:c.end,insert:updated.slice(c.start,updated.length-(text.length-c.end))});
  }
  return patches.sort((a,b)=>a.from-b.from);
}
