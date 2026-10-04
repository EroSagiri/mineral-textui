import {expect,test} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseTextUI,patchValues} from '@mineral/textui';
import {render} from '@mineral/textui-react';
import {createNodeHost} from '@mineral/textui-host-node';
import {MarkdownShowcase} from '../../examples/phase-3/markdown-showcase.tsx';
import {InteractiveForm} from '../../examples/phase-3/interactive-form.tsx';
import {CustomBlock,createSettingsTypes} from '../../examples/phase-3/custom-block.tsx';

test('three Phase 3 examples run through the Node file host and editor saves restore custom data',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'textui-components-')),errors:unknown[]=[];
  const host=createNodeHost(directory,{onError:e=>errors.push(e)}),types=createSettingsTypes();
  const roots:Awaited<ReturnType<typeof render>>[]=[];
  try {
    const showcase=await render(<MarkdownShowcase/>,{host,screen:'showcase',onError:e=>errors.push(e)});roots.push(showcase);
    expect(await readFile(join(directory,'showcase.md'),'utf8')).toContain('Server B \\| backup');
    const form=await render(<InteractiveForm/>,{host,screen:'form',onError:e=>errors.push(e)});roots.push(form);
    const original=await readFile(join(directory,'form.md'),'utf8');
    await writeFile(join(directory,'form.md'),patchValues(parseTextUI(original),new Map<string,string|boolean>([['name','Editor'],['submit',true]])));
    const wait=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw new Error('editor update timed out');await delay(20);}};
    await wait(()=>form.store.read('count')===1);await form.idle();expect(form.store.read('result')).toContain('Editor');
    const custom=await render(<CustomBlock types={types}/>,{host,screen:'custom',blockTypes:types,onError:e=>errors.push(e)});roots.push(custom);
    const path=join(directory,'custom.md'),text=await readFile(path,'utf8');
    await writeFile(path,'<!-- editor note -->\n'+text.replace('message=Hello\nenabled=true','message=Node editor\nenabled=false'));
    await wait(()=>custom.store.read('changes')===1);await custom.idle();expect(await readFile(path,'utf8')).toContain('| message | Node editor |');expect(await readFile(path,'utf8')).toContain('<!-- editor note -->');
    await custom.unmount();
    const restored=await render(<CustomBlock types={types}/>,{host,screen:'custom',blockTypes:types,onError:e=>errors.push(e)});roots.push(restored);
    expect(restored.store.read('settings')).toBe('message=Node editor\nenabled=false');expect(restored.store.read('changes')).toBe(1);expect(errors).toEqual([]);
  } finally{for(const root of roots.reverse())await root.unmount();await host.close();await rm(directory,{recursive:true,force:true});}
});
