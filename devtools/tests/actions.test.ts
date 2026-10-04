import {expect,it} from 'vitest';
import {actionAt,actionPatch} from '../src/editor/actions.ts';
import {applyPatches} from '../src/editor/diff.ts';
const text='- [ ] Any action <!-- textui:id=custom type=action -->\n';
it('enhancement patches only the generic Action marker',()=>{
  const patch=actionPatch(text,'custom')!;
  expect(applyPatches(text,[patch])).toBe(text.replace('[ ]','[x]'));
  expect(actionAt(text,patch.from+1)).toBe('custom');
  expect(actionAt(text,text.indexOf('Any'))).toBeNull();
  expect(actionPatch(text.replace('[ ]','[x]'),'custom')).toBeNull();
  expect(actionPatch('[tasks](https://tasks.md)','custom')).toBeNull();
});
it('disabled and readonly controls cannot be clicked',()=>{
  expect(actionPatch(text.replace('type=action','type=action disabled'),'custom')).toBeNull();
  expect(actionPatch(text.replace('type=action','type=action readonly'),'custom')).toBeNull();
});
