import {it,expect} from 'vitest';
import {activate} from '../vscode/runtime.ts';
import {state} from './vscode-mock.ts';
import type {ExtensionContext} from 'vscode';
it('VS Code adapter applies a versioned text edit and rejects stale and wrong-document messages',async()=>{
  activate({subscriptions:[],extensionUri:'extension:'} as unknown as ExtensionContext);state.command!();
  state.receive!({type:'ready'});expect(state.messages.at(-1).text).toContain('[ ]');
  state.receive!({type:'edit',uri:'file:///other.md',version:1,id:'deploy',value:true});
  await new Promise(resolve=>setTimeout(resolve,0));expect(state.writes).toBe(0);
  state.receive!({type:'edit',uri:'file:///screen.md',version:1,id:'deploy',value:true});
  await new Promise(resolve=>setTimeout(resolve,0));expect(state.text).toContain('[x]');expect(state.writes).toBe(1);
  state.text=state.text.replace('[x]','[ ]');state.version++;
  state.receive!({type:'edit',uri:'file:///screen.md',version:1,id:'deploy',value:true});
  await new Promise(resolve=>setTimeout(resolve,0));expect(state.text).toContain('[ ]');expect(state.writes).toBe(1);expect(state.messages.at(-1).version).toBe(3);
});
