import {Compartment,EditorState,StateEffect} from '@codemirror/state';
import {parseTextUI} from '@mineral/textui';
import {createEditor,applyRemote} from './editor/editor.ts';
import {EditorSync} from './editor/sync.ts';
import {ScreenClient} from './transport/screen-client.ts';
import {FrameClient} from './transport/frame-client.ts';
import {actionPatch} from './editor/actions.ts';
import type {DevtoolsFrame as TextFrame,DevtoolsScreen} from './api.js';
import type {SyncInfo} from './editor/sync.ts';
import {renderPreview} from './preview/renderer.ts';
import {previewPatches} from './preview/model.ts';
import projectPreview from 'virtual:textui-preview';
import './style.css';

document.querySelector('#app')!.innerHTML=`
  <header><div><span class="eyebrow">DEVELOPMENT WORKSPACE</span><h1>Mineral <span>TextUI DevTools</span></h1></div><span class="tag">Markdown · Live sync</span></header>
  <nav aria-label="连接设置">
    <label>Host <select id="host"></select></label>
    <label>Screen <select id="screen"></select></label>
    <label>Screen ID <input id="screen-id" placeholder="输入 Screen ID"></label><button id="open-screen">打开</button><button id="discover">刷新列表</button><label>视图 <select id="layout"><option value="split">Split</option><option value="preview">Preview</option><option value="source">Source</option></select></label><label>自动保存 <input id="debounce" type="number" value="500" min="100" max="10000" step="100"> ms</label>
    <button id="save">立即保存</button><button id="retry">重试连接 / 保存</button><span id="dev-status" class="connection"></span><span id="connection" class="connection">连接中</span>
  </nav>
  <main><section class="editor-panel"><div class="panel-heading"><h2>Source · Markdown</h2><span id="status">Disconnected</span></div><div id="text-actions" role="group" aria-label="文本 Action" hidden></div><p class="hint" id="hint">把 Action 的 [ ] 改为 [x] 并保存即可操作。点击操作按钮或原文 Action 方括号，也只改写这三个字符。页面导航由应用处理。</p><div id="editor"></div><footer><span id="cursor">Ln 1, Col 1</span><span id="patch-info">局部更新 · 保留选区与撤销</span></footer></section>
  <section class="preview-panel"><div class="panel-heading"><h2>Live Preview</h2><select id="preview-mode" aria-label="Preview source"><option value="preview">Preview · local buffer</option><option value="runtime">Runtime · confirmed Screen</option></select></div><p id="preview-source" class="hint"></p><p id="preview-error" role="alert"></p><div id="preview" class="markdown-preview"></div></section><aside><section class="inspector"><div class="panel-heading"><h2>Screen Inspector</h2><span class="tag small">LIVE</span></div><dl id="metrics"></dl><p id="error" role="alert"></p><p class="hint">存储和导航由应用提供。Preview 操作只修改 Markdown，通过 ScreenPort 保存。</p></section>
  <section id="conflict" hidden><h2>修改冲突</h2><p>本地输入已保留，自动保存已暂停。</p><label>远程版本<textarea id="remote" readonly></textarea></label><label>手动合并<textarea id="manual"></textarea></label><div class="conflict-buttons"><button id="use-local">采用本地</button><button id="use-remote">采用远程</button><button id="use-manual">保存手动合并</button></div></section>
  <section><div class="panel-heading"><h2>Runtime Inspector</h2><button id="inspect">刷新</button></div><pre id="inspection">应用可提供 State / Tree / Router 信息</pre><details><summary>已保留的其他会话草稿</summary><div id="drafts"></div></details></section><section class="events"><div class="panel-heading"><h2>Event Log</h2><button id="clear-log">清空</button></div><ol id="log"></ol></section></aside></main>`;
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const hostSelect=element<HTMLSelectElement>('host'), screenSelect=element<HTMLSelectElement>('screen');
let sync:EditorSync|undefined, connecting=false, connected=false, patches=0,characters=0,frames=new FrameClient(),lastFrame:TextFrame|null=null;
let expiry:ReturnType<typeof setTimeout>|undefined, displayRevision='';
let actionText:string|undefined;
let previewRegistry=projectPreview;
function triggerAction(id:string):boolean{
  if(connecting || !sync?.info.base || sync.info.composing || sync.info.status==='Conflict')return false;
  const patch=actionPatch(view.state.doc.toString(),id);if(!patch)return false;
  view.dispatch({changes:patch,userEvent:'input.action'});return true;
}
function updatePreview(){
  const runtime=element<HTMLSelectElement>('preview-mode').value==='runtime',info=sync?.info;
  element('preview-source').textContent=runtime?`Screen revision: ${info?.base?.revision??'—'}`:`Editor: ${sync?.dirty?'dirty':'saved'} · Screen revision: ${info?.base?.revision??'—'}`;
  const error=renderPreview(element('preview'),runtime?(info?.base?.text??''):(info?.localText??''),{
    writable:!runtime && !connecting && !!info?.base && !info.composing && info.status!=='Conflict',
    frame:runtime || sync?.dirty?null:lastFrame,
    registry:previewRegistry,
    onEdit:edit=>{try{const changes=previewPatches(view.state.doc.toString(),edit);if(changes.length)view.dispatch({changes,userEvent:'input.preview'});}catch(error){element('preview-error').textContent=String(error);}},
  });
  element('preview-error').textContent=error??'';
}
function renderActions(){
  const text=sync?.info.localText??'',container=element('text-actions');
  if(text!==actionText){
    actionText=text;container.replaceChildren();
    try{for(const control of parseTextUI(text).controls.values())if(control.type==='action'){
      const button=document.createElement('button');button.textContent=control.label;button.dataset.action=control.id;button.onclick=()=>{triggerAction(control.id);};container.append(button);
    }}catch{}
  }
  for(const button of container.querySelectorAll('button'))button.disabled=connecting || sync?.info.composing===true || sync?.info.status==='Conflict' || !actionPatch(text,button.dataset.action!);
  container.hidden=container.childElementCount===0;
}
const log=(event:string)=>{
  const item=document.createElement('li');const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString();item.append(time,` ${event}`);
  const list=element('log');list.prepend(item);while(list.children.length>120)list.lastElementChild!.remove();
};
const writable=new Compartment();
const makeEditor=()=>createEditor(element('editor'),text=>sync?.edit(text),active=>{
  sync?.composition(active);
},()=>{
  const range=view.state.selection.main,line=view.state.doc.lineAt(range.head);
  element('cursor').textContent=`Ln ${line.number}, Col ${range.head-line.from+1} · 选区 ${range.from}–${range.to}`;
},triggerAction);
let view=makeEditor();
view.dispatch({effects:StateEffect.appendConfig.of(writable.of(EditorState.readOnly.of(true)))});
const clearFrames=()=>{lastFrame=null;clearTimeout(expiry);updatePreview();};
const renderInfo=()=>{
  renderActions();
  const info=sync?.info;
  element('status').textContent=info?.status??'Disconnected';element('status').dataset.state=info?.status??'Disconnected';
  element('connection').textContent=connected?'● 已连接':'○ 未连接';element('connection').classList.toggle('online',connected);
  element('error').textContent=info?.error??'';
  const values:Record<string,string|number>={Screen:sync?.id??'—',Revision:info?.base?.revision??'—','保存次数':info?.saves??0,'冲突次数':info?.conflicts??0,'补丁数量':patches,'修改字符数':characters,'帧接收数':frames.received,'帧丢弃数':frames.dropped,'组合输入':info?.composing?'输入中':'否'};
  const list=element('metrics');list.replaceChildren();
  for(const [label,value] of Object.entries(values)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);dd.dataset.metric=label;list.append(dt,dd);}
  element('conflict').hidden=info?.status!=='Conflict';
  if(info?.status==='Conflict'){
    element<HTMLTextAreaElement>('remote').value=info.remote?.text??'';
    const manual=element<HTMLTextAreaElement>('manual');if(!manual.dataset.active){manual.value=info.localText;manual.dataset.active='true';}
  }else delete element('manual').dataset.active;
  if(info?.base && displayRevision!==info.base.revision){displayRevision=info.base.revision;clearFrames();}
  updatePreview();
};
let sessionId='',defaultScreen:string|null=null;
let screens:DevtoolsScreen[]=[];
const drafts=new Map<string,SyncInfo>();
let activeKey='';
const draftKey=(host:string,id:string)=>JSON.stringify([host,id]);
function showDrafts(){
  const container=element('drafts');container.replaceChildren();
  for(const [key,info] of drafts){if(key===activeKey || info.localText===info.base?.text)continue;
    const label=document.createElement('p');label.textContent=key;
    const text=document.createElement('textarea');text.readOnly=true;text.value=info.localText;container.append(label,text);
  }
}
async function loadConfiguration(){
  const response=await fetch('/api/config');if(!response.ok)throw new Error(await response.text());
  const config=await response.json();
  sessionId=config.session.id;defaultScreen=config.defaultScreen;screens=config.screens;
  hostSelect.replaceChildren();const option=document.createElement('option');option.value=sessionId;option.textContent=`${config.session.label} · ${config.session.mode}`;hostSelect.append(option);
  element('dev-status').textContent=config.dev?.error??'';return config;
}
function setScreens(_host:string,selected?:string){
  if(selected && !screens.some(screen=>screen.id===selected))screens.push({id:selected});
  screenSelect.replaceChildren(...screens.map(screen=>{const option=document.createElement('option');option.value=screen.id;option.textContent=screen.label??screen.id;return option;}));
  if(selected)screenSelect.value=selected;
}
async function connect(host:string,id:string){
  if(connecting)return;
  connecting=true;hostSelect.disabled=true;screenSelect.disabled=true;
  try {
    if(sync?.info.composing){log('请完成当前输入后切换 Screen');screenSelect.value=sync.id;return;}
    if(sync){await sync.close();drafts.set(activeKey,structuredClone(sync.info));}
    activeKey=draftKey(host,id);clearFrames();
    view.destroy();view=makeEditor();
    view.dispatch({effects:StateEffect.appendConfig.of(writable.of(EditorState.readOnly.of(true)))});
    patches=0;characters=0;frames=new FrameClient();displayRevision='';connected=false;
    view.dispatch({effects:writable.reconfigure(EditorState.readOnly.of(true))});
    const port=new ScreenClient(`/api/runtime`,online=>{
      connected=online;
      if(!online)sync?.disconnect();
      renderInfo();
    },frame=>{
      if(frames.accept(frame,sync?.info.base??null)){
        lastFrame=frame;
        clearTimeout(expiry);expiry=setTimeout(clearFrames,2100);log(`动画帧 ${frame.sequence}`);
      }else log(`丢弃动画帧 ${frame.sequence}`);
      renderInfo();
    },clearFrames,host);
    sync=new EditorSync(port,id,text=>{
      const result=applyRemote(view,text);patches+=result.patches;characters+=result.characters;
      if(result.patches)log(`增量补丁 ${result.patches}，字符 ${result.characters}`);
    },()=>renderInfo(),log,Number(element<HTMLInputElement>('debounce').value));
    const draft=drafts.get(activeKey);
    if(draft){Object.assign(sync.info,structuredClone(draft),{composing:false});applyRemote(view,draft.localText);}
    showDrafts();renderInfo();await sync.start();
    view.dispatch({effects:writable.reconfigure(EditorState.readOnly.of(!sync.info.base))});view.focus();
    const url=new URL(location.href);url.searchParams.delete('host');url.searchParams.set('screen',id);history.replaceState(null,'',url);
  }catch(error){sync?.disconnect();element('error').textContent=error instanceof Error?error.message:String(error);log(String(error));}
  finally{connecting=false;hostSelect.disabled=false;screenSelect.disabled=false;renderActions();updatePreview();}
}
hostSelect.onchange=()=>{setScreens(hostSelect.value);void connect(hostSelect.value,screenSelect.value);};
screenSelect.onchange=()=>{void connect(hostSelect.value,screenSelect.value);};
element('preview-mode').onchange=updatePreview;
element('save').onclick=()=>{void sync?.save();};
element('retry').onclick=()=>{if(!sync?.info.base)void connect(hostSelect.value,screenSelect.value);else void sync.retry();};
element<HTMLInputElement>('debounce').onchange=event=>{const input=event.target as HTMLInputElement;input.value=String(Math.min(10000,Math.max(100,Number(input.value)||500)));if(sync)sync.debounceMs=Number(input.value);};
element('clear-log').onclick=()=>element('log').replaceChildren();
for(const choice of ['local','remote','manual'] as const)element(`use-${choice}`).onclick=()=>{void sync?.resolve(choice,element<HTMLTextAreaElement>('manual').value);};
window.addEventListener('beforeunload',event=>{if(sync?.dirty || [...drafts.values()].some(info=>info.localText!==info.base?.text)){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',()=>{void sync?.refresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync?.refresh();});
const params=new URLSearchParams(location.search);
try{
  await loadConfiguration();setScreens(sessionId,params.get('screen')??defaultScreen??undefined);
  if(screenSelect.value)await connect(sessionId,screenSelect.value);
  else element('connection').textContent='已连接 · 输入 Screen ID';
}catch(error){element('error').textContent=String(error);}
element('open-screen').onclick=()=>{const id=element<HTMLInputElement>('screen-id').value;if(id){setScreens(sessionId,id);void connect(sessionId,id);}};
element('discover').onclick=()=>{const old=sessionId;void loadConfiguration().then(()=>{setScreens(sessionId,sync?.id);if(old!==sessionId && screenSelect.value)void connect(sessionId,screenSelect.value);}).catch(error=>log(String(error)));};
element('inspect').onclick=()=>{void fetch('/api/inspect').then(async response=>{if(!response.ok)throw new Error(await response.text());element('inspection').textContent=JSON.stringify(await response.json(),null,2);}).catch(error=>log(String(error)));};
element('layout').onchange=()=>{document.querySelector('main')!.setAttribute('data-layout',element<HTMLSelectElement>('layout').value);view.requestMeasure();};
if(import.meta.hot)import.meta.hot.on('textui:session',()=>{void (async()=>{
  await sync?.close();
  await loadConfiguration();setScreens(sessionId,sync?.id??defaultScreen??undefined);
  if(screenSelect.value)await connect(sessionId,screenSelect.value);
})().catch(error=>{element('error').textContent=String(error);log(String(error));});});

if(import.meta.hot)import.meta.hot.on('textui:app-status',(status:{reloads:number;reloading:boolean;error:string})=>{
  element('dev-status').textContent=status.error?`Reload failed: ${status.error}`:status.reloading?'Reloading App…':`App reloaded (${status.reloads})`;
  log(status.error?`App reload failed: ${status.error}`:`App reload ${status.reloads}`);
});

if(import.meta.hot)import.meta.hot.accept('virtual:textui-preview',module=>{
  previewRegistry=module?.default;updatePreview();
});
