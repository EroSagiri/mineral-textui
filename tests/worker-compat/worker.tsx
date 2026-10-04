import {verifyPhase6} from '../phase-6-probe.tsx';
import {MemoryScreen,parseTextUI,patchValues,ScreenConflictError} from '@mineral/textui';
import {render} from '@mineral/textui-react';
import {UserForm} from '../../examples/user-form/app.tsx';
import {MarkdownShowcase} from '../../examples/phase-3/markdown-showcase.tsx';
import {CustomBlock,createSettingsTypes} from '../../examples/phase-3/custom-block.tsx';

function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
export default {
  async fetch():Promise<Response> {
    const phase6=await verifyPhase6();
    const host=new MemoryScreen(),errors:Error[]=[];
    const root=await render(<UserForm/>,{host,screen:'user',onError:error=>errors.push(error)});
    try {
      const initial=(await host.getScreen('user'))!;
      const controls=parseTextUI(initial.text).controls;
      const id=(label:string)=>[...controls.values()].find(c=>c.label===label)!.id;
      const updates=new Map<string,string|boolean>([[id('Name'),'Worker'],[id('Enable sound'),false],[id('Light'),true],['submit-main',true],['submit-preview',true]]);
      await host.setScreen('user',patchValues(parseTextUI(initial.text),updates),{expectedRevision:initial.revision,origin:'test-editor'});
      await root.idle();
      const committed=(await host.getScreen('user'))!,parsed=parseTextUI(committed.text);
      assert(root.store.read('name')==='Worker','Input did not update');
      assert(root.store.read('sound')===false,'Check did not update');
      assert(root.store.read('theme')==='light','Select did not update');
      assert(root.store.read('main-count')===1 && root.store.read('preview-count')===1,'Submit counters are not independent');
      assert(parsed.controls.get('submit-main')!.value===false && parsed.controls.get('submit-preview')!.value===false,'Action did not reset');
      assert(parsed.controls.get(id('Dark'))!.value===false,'Select group is not exclusive');
      root.store.set('name','Internal worker update');await root.flush();
      assert((await host.getScreen('user'))!.text.includes('Internal worker update'),'React-to-Screen update failed');
      let conflict=false;
      try{await host.setScreen('user','stale',{expectedRevision:initial.revision});}catch(error){conflict=error instanceof ScreenConflictError;}
      assert(conflict,'stale revision did not fail');assert(errors.length===0,errors.map(e=>e.message).join(';'));
      const types=createSettingsTypes();
      const showcase=await render(<MarkdownShowcase/>,{host,screen:'showcase',onError:error=>errors.push(error)});
      const expanded=await render(<CustomBlock types={types}/>,{host,screen:'phase3',blockTypes:types,onError:error=>errors.push(error)});
      try {
        const first=(await host.getScreen('phase3'))!;
        const markdown=(await host.getScreen('showcase'))!.text;
        assert(markdown.includes('| :--- | :---: | ---: |'),'GFM table did not render');
        assert(markdown.includes('```typescript') || markdown.includes('````typescript'),'CodeBlock did not render');
        assert(markdown.includes('[a standard link](<https://example.com>'),'Link did not render');
        await host.setScreen('phase3',first.text.replace('message=Hello\nenabled=true','message=Worker\nenabled=false'),{expectedRevision:first.revision});
        await expanded.idle();
        assert(expanded.store.read('settings')==='message=Worker\nenabled=false','Block did not hydrate');
        assert(expanded.store.read('changes')===1,'Block semantic event did not fire once');
        const stable=(await host.getScreen('phase3'))!;await expanded.flush();
        assert((await host.getScreen('phase3'))!.revision===stable.revision,'No-op flush wrote new content');
        expanded.store.set('settings','message=React\nenabled=true');await expanded.flush();await expanded.idle();
        assert(expanded.store.read('changes')===1,'React echo dispatched a Block event');
        assert(parseTextUI((await host.getScreen('phase3'))!.text).blocks.get('settings')!.value==='message=React\nenabled=true','Block write failed');
        assert(errors.length===0,errors.map(e=>e.message).join(';'));
      } finally{await expanded.unmount();await showcase.unmount();}
      assert(!('document' in globalThis),'unexpected DOM');
      // Wrangler may provide an env-only process shim to dependencies; that is not nodejs_compat.
      let nodeFsAvailable=false;
      try{const moduleName='node:'+['fs'].join('');await import(moduleName);nodeFsAvailable=true;}catch{}
      assert(!nodeFsAvailable,'Node filesystem is unexpectedly available');
      return Response.json({ok:true,runtime:'workerd',nodeCompatibility:false,controls:parsed.controls.size,name:root.store.read('name'),sound:root.store.read('sound'),theme:root.store.read('theme'),mainCount:root.store.read('main-count'),previewCount:root.store.read('preview-count'),conflictDetected:conflict,markdownComponents:true,customBlocks:true,phase6});
    } finally{await root.unmount();}
  },
};
