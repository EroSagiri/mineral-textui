import {expect,test} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createNodeHost} from '@mineral/textui-host-node';
import {render} from '@mineral/textui-react';
import {parseTextUI,patchValues,fencedCode} from '@mineral/textui';
import {AdvancedForm} from '../../examples/phase-6/advanced-form.tsx';
import {InlineMarkdownShowcase} from '../../examples/phase-6/inline-markdown-showcase.tsx';
test('Phase 6 examples run on real files: edit, invalid number, submit validation, restart and dynamic formatting',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'textui-phase6-')),errors:Error[]=[];
  const host=createNodeHost(directory,{onError:e=>errors.push(e instanceof Error?e:new Error(String(e)))});const roots:Awaited<ReturnType<typeof render>>[]=[];
  const wait=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw new Error('editor update timed out');await new Promise(r=>setTimeout(r,20));}};
  try {
    const root=await render(<AdvancedForm/>,{host,screen:'form',onError:e=>errors.push(e)});roots.push(root);
    const path=join(directory,'form.md'),initial=await readFile(path,'utf8');
    const edit='<!-- keep exactly -->\n'+patchValues(parseTextUI(initial),new Map<string,string|boolean>([['name','Edited task'],['retries','4'],['submit',true]])).replace(fencedCode('构建并测试项目。','textui','type=textarea id=description'),fencedCode('多行\n  text\n```','textui','type=textarea id=description'));
    await writeFile(path,edit);await wait(()=>String(root.store.read('result')).includes('已提交 Edited task'));await root.idle();
    expect(await readFile(path,'utf8')).toContain('<!-- keep exactly -->');expect(root.store.read('description')).toBe('多行\n  text\n```');
    const confirmed=await readFile(path,'utf8');const invalid=patchValues(parseTextUI(confirmed),new Map([['retries','Infinity']]));await writeFile(path,invalid);await wait(()=>errors.length===1);await root.idle();expect(await readFile(path,'utf8')).toBe(invalid);expect(root.store.read('retries')).toBe(4);
    await writeFile(path,patchValues(parseTextUI(confirmed),new Map([['retries','5']])));await wait(()=>root.store.read('retries')===5);await root.idle();
    await writeFile(path,patchValues(parseTextUI(confirmed),new Map<string,string|boolean>([['name',''],['submit',true]])));await wait(()=>String(root.store.read('result')).includes('必填'));await root.idle();expect(root.store.read('name')).toBe('');
    await root.unmount();const restored=await render(<AdvancedForm/>,{host,screen:'form',onError:e=>errors.push(e)});roots.push(restored);expect(restored.store.read('retries')).toBe(4);expect(restored.store.read('description')).toBe('多行\n  text\n```');
    const showcase=await render(<InlineMarkdownShowcase/>,{host,screen:'showcase',onError:e=>errors.push(e)});roots.push(showcase);const show=join(directory,'showcase.md');const first=await readFile(show,'utf8');await writeFile(show,patchValues(parseTextUI(first),new Map([['status','Changed * 🟢']])));await wait(()=>showcase.store.read('status')==='Changed * 🟢');await showcase.idle();expect(await readFile(show,'utf8')).toContain(String.raw`**Changed \* 🟢**`);expect(errors).toHaveLength(1);
  }finally{for(const root of roots.reverse())await root.unmount();await host.close();await rm(directory,{recursive:true,force:true});}
});
