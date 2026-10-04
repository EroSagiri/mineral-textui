import {describe,it,expect} from 'vitest';
import {parseTextUI} from '@mineral/textui';
import {previewPatches} from '../src/preview/model.ts';
const apply=(text:string,id:string,value:string|boolean)=>previewPatches(text,{id,value}).sort((a,b)=>b.from-a.from).reduce((result,patch)=>result.slice(0,patch.from)+patch.insert+result.slice(patch.to),text);
describe('Preview text protocol',()=>{
  it('patches the Action marker and preserves unrelated Markdown',()=>{
    const text='# Hello\n- [ ] Deploy <!-- textui:id=deploy type=action -->\n**Note**\n';
    expect(apply(text,'deploy',true)).toBe(text.replace('[ ]','[x]'));
    expect(previewPatches(apply(text,'deploy',true),{id:'deploy',value:true})).toEqual([]);
  });
  it('escapes input and retains partial number text for runtime validation',()=>{
    const text='Name: [June] <!-- textui:id=name type=input -->\nAge: [2] <!-- textui:id=age type=number -->';
    const updated=apply(apply(text,'name','a]b\\c'),'age','-');
    expect(parseTextUI(updated).controls.get('name')?.value).toBe('a]b\\c');
    expect(parseTextUI(updated).controls.get('age')?.value).toBe('-');
  });
  it('updates a radio group atomically and respects locked peers',()=>{
    const text='(*) One <!-- textui:id=a type=select group=g -->\n( ) Two <!-- textui:id=b type=select group=g -->';
    const parsed=parseTextUI(apply(text,'b',true));expect(parsed.controls.get('a')?.value).toBe(false);expect(parsed.controls.get('b')?.value).toBe(true);
    expect(previewPatches(text.replace('id=a','readOnly=true id=a'),{id:'b',value:true})).toEqual([]);
  });
  it('preserves CRLF, metadata and expands a textarea fence when necessary',()=>{
    const text='> ```text type=textarea id=body required=true\r\n> old\r\n> ```\r\nTAIL';
    const value='first\n```\n最后';const updated=apply(text,'body',value);
    expect(parseTextUI(updated).blocks.get('body')?.value.replaceAll('\r\n','\n')).toBe(value);
    expect(updated).toContain('````text type=textarea id=body required=true');expect(updated.endsWith('\r\nTAIL')).toBe(true);
  });
  it('rejects protected controls and malformed protocols',()=>{
    for(const constraint of ['disabled=true','readOnly=true'])expect(previewPatches(`Name: [June] <!-- textui:id=n type=input ${constraint} -->`,{id:'n',value:'x'})).toEqual([]);
    expect(()=>previewPatches('Name: [June] <!-- textui:id=n type=input',{id:'n',value:'x'})).toThrow();
  });
});
