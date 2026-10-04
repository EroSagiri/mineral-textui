import {renderPreview} from '../src/preview/renderer.ts';
import projectPreview from 'virtual:textui-preview';
declare function acquireVsCodeApi():{postMessage(message:unknown):void};
const vscode=acquireVsCodeApi();
let uri='',version=0,pending=false;
window.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='error'){document.getElementById('error')!.textContent=message.message;pending=false;return;}
  if(message.type!=='document')return;
  uri=message.uri;version=message.version;pending=false;
  document.getElementById('status')!.textContent=`Document v${version} · ${message.dirty?'unsaved buffer':'saved'} · Save the document to send changes to a file Host`;
  const error=renderPreview(document.getElementById('preview')!,message.text,{writable:true,commit:'change',registry:projectPreview,onEdit:edit=>{
    if(pending)return;pending=true;
    for(const input of document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>('#preview input,#preview textarea,#preview button'))input.disabled=true;
    vscode.postMessage({type:'edit',uri,version,...edit});
  }});
  document.getElementById('error')!.textContent=error??'';
});
vscode.postMessage({type:'ready'});
