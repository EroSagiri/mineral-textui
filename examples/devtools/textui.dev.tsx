import {defineDevtools} from '@mineral/textui-devtools';
import {MemoryScreen} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,ScreenWriteOptions,ScreenChange} from '@mineral/textui';
import {render} from '@mineral/textui-react';
import {createElement} from 'react';

// Application-owned adapter. Devtools sees only the three ScreenPort methods.
class ApplicationPort implements ScreenPort {
  private storage=new MemoryScreen();
  getScreen(id:string):Promise<ScreenSnapshot|null>{return this.storage.getScreen(id);}
  setScreen(id:string,text:string,options:ScreenWriteOptions){return this.storage.setScreen(id,text,options);}
  onScreenChange(id:string,listener:(change:ScreenChange)=>void){return this.storage.onScreenChange(id,listener);}
}
export default defineDevtools({
  preview:'examples/devtools/preview.ts',
  async createSession(context){
    const storage=new ApplicationPort();
    await storage.setScreen('manual only','# Manual Screen\n\nNot included in discovery.',{expectedRevision:null});
    const port=context.observePort(storage);
    const entry='examples/devtools/app.tsx';
    const module=await context.loadModule(entry);
    const roots=await Promise.all(['home','settings/nested'].map(screen=>render(createElement(module.default),{host:port,screen})));
    return {
      label:'Custom ScreenPort example',mode:'local',port,entry,
      discovery:{async listScreens(){return [{id:'home',label:'Home'},{id:'settings/nested',label:'Settings'}];}},
      app:{async update(node){for(const root of roots)await root.update(node);},async unmount(){for(const root of roots)await root.unmount();}},
      inspect:()=>({state:Object.fromEntries(roots.map((root,index)=>[index,Object.fromEntries(root.store.snapshot())])),router:{providedBy:'application',screens:['home','settings/nested']}}),
    };
  },
});
