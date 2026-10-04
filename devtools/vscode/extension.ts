import * as vscode from 'vscode';
import {createRequire} from 'node:module';
import {watchFile,unwatchFile} from 'node:fs';
import {join} from 'node:path';
import type {activate as activateRuntime} from './runtime.ts';
export function activate(context:vscode.ExtensionContext){
  const require=createRequire(join(context.extensionPath,'dist','extension.cjs'));
  const runtimePath=join(context.extensionPath,'dist','runtime.cjs');
  const marker=join(context.extensionPath,'dist','reload.json');
  let runtime:ReturnType<typeof activateRuntime>|undefined;
  const load=()=>{
    const documents=runtime?.dispose()??[];
    delete require.cache[require.resolve(runtimePath)];
    const scope=Object.create(context) as vscode.ExtensionContext;
    Object.defineProperty(scope,'subscriptions',{value:[]});
    runtime=(require(runtimePath) as {activate:typeof activateRuntime}).activate(scope);
    for(const document of documents)if(!document.isClosed)runtime.openPreview(document);
  };
  load();
  if(context.extensionMode===vscode.ExtensionMode.Development)watchFile(marker,{interval:300},()=>{
    try{load();}catch(error){void vscode.window.showErrorMessage(`TextUI reload failed: ${String(error)}`);}
  });
  context.subscriptions.push({dispose(){unwatchFile(marker);runtime?.dispose();}});
}
