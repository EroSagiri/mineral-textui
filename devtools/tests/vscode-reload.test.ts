import {it,expect,vi} from 'vitest';
import type {ExtensionContext,TextDocument} from 'vscode';
const state=vi.hoisted(()=>({loads:0,disposed:0,opened:[] as unknown[],watch:undefined as undefined|(()=>void),unwatch:vi.fn(),document:{isClosed:false}}));
vi.mock('node:fs',()=>({watchFile:(_path:string,_options:unknown,callback:()=>void)=>{state.watch=callback;},unwatchFile:state.unwatch}));
vi.mock('node:module',()=>({createRequire:()=>Object.assign(()=>({activate:()=>{
  state.loads++;
  return {dispose(){state.disposed++;return [state.document];},openPreview(document:TextDocument){state.opened.push(document);}};
}}),{cache:{},resolve:(path:string)=>path})}));
import {activate} from '../vscode/extension.ts';
it('reloads the runtime and restores bound previews without reloading the VS Code window',()=>{
  const subscriptions:{dispose():void}[]=[];
  activate({extensionPath:'/extension',extensionMode:2,subscriptions} as unknown as ExtensionContext);
  expect(state.loads).toBe(1);state.watch!();
  expect(state.loads).toBe(2);expect(state.disposed).toBe(1);expect(state.opened).toEqual([state.document]);
  subscriptions[0].dispose();expect(state.unwatch).toHaveBeenCalled();expect(state.disposed).toBe(2);
});
