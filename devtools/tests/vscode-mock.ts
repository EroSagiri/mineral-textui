// A document adapter harness; real Extension Host UI is a separate manual check.
export const disposable={dispose(){}};
export const state={command:undefined as undefined|(()=>void),receive:undefined as undefined|((message:unknown)=>void),change:undefined as undefined|((event:unknown)=>void),text:'- [ ] Deploy <!-- textui:id=deploy type=action -->',version:1,messages:[] as any[],writes:0};
export const document={uri:{path:'/screen.md',toString:()=> 'file:///screen.md'},languageId:'markdown',get version(){return state.version;},isClosed:false,isDirty:false,getText:()=>state.text,positionAt:(offset:number)=>offset};
export const commands={registerCommand:(_id:string,command:()=>void)=>{state.command=command;return disposable;}};
export const Uri={joinPath:(...parts:unknown[])=>parts.join('/')};
export const ViewColumn={Beside:2};
export const ExtensionMode={Development:2,Production:1};
export class Range{constructor(public from:number,public to:number){}}
export class WorkspaceEdit{
  edits:{range:Range;insert:string}[]=[];
  replace(_uri:unknown,range:Range,insert:string){this.edits.push({range,insert});}
}
export const workspace={
  onDidChangeTextDocument:(listener:(event:unknown)=>void)=>{state.change=listener;return disposable;},
  onDidSaveTextDocument:()=>disposable,onDidCloseTextDocument:()=>disposable,
  applyEdit:async(edit:WorkspaceEdit)=>{state.writes++;for(const item of edit.edits.sort((a,b)=>b.range.from-a.range.from))state.text=state.text.slice(0,item.range.from)+item.insert+state.text.slice(item.range.to);state.version++;state.change?.({document});return true;},
};
export const window={activeTextEditor:{document},showInformationMessage(){},createWebviewPanel:()=>({
  webview:{html:'',cspSource:'test:',asWebviewUri:()=> 'test:webview.js',postMessage:async(message:unknown)=>{state.messages.push(message);return true;},onDidReceiveMessage:(listener:(message:unknown)=>void)=>{state.receive=listener;return disposable;}},
  onDidDispose:()=>disposable,dispose(){},
})};
