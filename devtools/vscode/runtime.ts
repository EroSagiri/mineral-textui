import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import {previewPatches} from '../src/preview/model.ts';

export function activate(context:vscode.ExtensionContext){
  let active=true;
  const panels=new Map<vscode.WebviewPanel,vscode.TextDocument>();
  const openPreview=(document:vscode.TextDocument|undefined)=>{
    if(!document || document.languageId!=='markdown'){void vscode.window.showInformationMessage('Open a Markdown Screen first.');return;}
    const panel=vscode.window.createWebviewPanel('textui.preview',`TextUI: ${document.uri.path.split('/').at(-1)}`,vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'dist')]});
    panels.set(panel,document);
    const script=panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'dist','webview.js'));
    const nonce=randomBytes(18).toString('hex');
    panel.webview.html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}input,textarea,button{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:6px}textarea{width:95%;min-height:140px}label{display:inline-flex;align-items:center;gap:8px}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid;padding:6px}img{max-width:100%}#error{color:var(--vscode-errorForeground)}#status{opacity:.7;font-size:12px}</style></head><body><p id="status"></p><p id="error" role="alert"></p><main id="preview"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const update=()=>panel.webview.postMessage({type:'document',uri:document.uri.toString(),version:document.version,dirty:document.isDirty,text:document.getText()});
    let tail=Promise.resolve();
    const disposables=[
      vscode.workspace.onDidChangeTextDocument(event=>{if(event.document===document)void update();}),
      vscode.workspace.onDidSaveTextDocument(saved=>{if(saved===document)void update();}),
      vscode.workspace.onDidCloseTextDocument(closed=>{if(closed===document)panel.dispose();}),
      panel.webview.onDidReceiveMessage((message:unknown)=>{
        if(!message || typeof message!=='object' || !('type' in message))return;
        if(message.type==='ready'){void update();return;}
        if(message.type!=='edit' || !('uri' in message) || !('version' in message) || !('id' in message) || !('value' in message) || typeof message.id!=='string' || !['string','boolean'].includes(typeof message.value))return;
        const edit=message as {uri:string;version:number;id:string;value:string|boolean};
        tail=tail.then(async()=>{
          if(!active)return;
          // Reject delayed webview edits after typing, undo, or another Preview operation.
          if(document.isClosed || edit.uri!==document.uri.toString() || edit.version!==document.version){await update();return;}
          const patches=previewPatches(document.getText(),edit),workspaceEdit=new vscode.WorkspaceEdit();
          for(const patch of patches)workspaceEdit.replace(document.uri,new vscode.Range(document.positionAt(patch.from),document.positionAt(patch.to)),patch.insert);
          if(patches.length)await vscode.workspace.applyEdit(workspaceEdit);
          await update();
        }).catch(async error=>{await update();await panel.webview.postMessage({type:'error',message:String(error)});});
      }),
    ];
    panel.onDidDispose(()=>{panels.delete(panel);for(const disposable of disposables)disposable.dispose();});
  };
  context.subscriptions.push(vscode.commands.registerCommand('textui.openPreview',()=>openPreview(vscode.window.activeTextEditor?.document)));
  return {openPreview,dispose(){active=false;const documents=[...panels.values()];for(const panel of panels.keys())panel.dispose();for(const disposable of context.subscriptions)disposable.dispose();return documents;}};
}
