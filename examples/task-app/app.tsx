import {useLayoutEffect} from 'react';
import {MemoryRouter,Route,Routes,useLocation,useNavigate} from 'react-router';
import {BlockTypeRegistry,parseTextUI} from '@mineral/textui';
import type {ScreenPort,ScreenSnapshot,UIEvent} from '@mineral/textui';
import {render,Screen,Section,Text,Check,Input,Select,Action,Output,Block,useTextState} from '@mineral/textui-react';

export const taskScreenId='app';
export type TaskPath='/'|'/tasks'|'/settings';
interface TaskState {path:TaskPath;name:string;prototype:boolean;docs:boolean;publish:boolean;notifications:boolean;theme:'dark'|'light'}
const defaults:TaskState={path:'/',name:'朋友',prototype:false,docs:false,publish:false,notifications:false,theme:'dark'};
const paths:readonly string[]=['/','/tasks','/settings'];
export function parseTaskState(text:string):TaskState{
  const s:unknown=JSON.parse(text);
  if(!s || typeof s!=='object')throw new Error('无效任务状态');
  const v=s as TaskState;
  if(!paths.includes(v.path)||typeof v.name!=='string'||[v.prototype,v.docs,v.publish,v.notifications].some(value=>typeof value!=='boolean')||!['dark','light'].includes(v.theme))throw new Error('无效任务状态');
  return {path:v.path,name:v.name,prototype:v.prototype,docs:v.docs,publish:v.publish,notifications:v.notifications,theme:v.theme};
}
function stateFromSnapshot(snapshot:ScreenSnapshot|null):TaskState{
  if(!snapshot)return {...defaults};
  const block=parseTextUI(snapshot.text).blocks.get('app-state');
  if(block?.type!=='task-state')throw new Error('单 Screen 任务应用缺少 app-state；旧版三屏文件不会被自动覆盖。');
  return parseTaskState(block.value);
}
export function taskBlockTypes(){const types=new BlockTypeRegistry();types.register<TaskState>('task-state',{parse:parseTaskState,serialize:value=>JSON.stringify(parseTaskState(JSON.stringify(value)))});return types;}
export interface TaskAppOptions {screen?:string;onEvent?:(event:UIEvent)=>void;onError?:(error:Error)=>void}

function TaskView({initial,event}:{initial:TaskState;event:(value:UIEvent)=>void}){
  const [json,setJson]=useTextState('app-state',JSON.stringify(initial));
  const state=parseTaskState(json),navigate=useNavigate(),location=useLocation();
  const update=(patch:Partial<TaskState>)=>setJson(current=>JSON.stringify({...parseTaskState(current),...patch}));
  useLayoutEffect(()=>{if(location.pathname!==state.path)navigate(state.path,{replace:true});},[state.path,location.pathname,navigate]);
  const go=(path:TaskPath,value:UIEvent)=>{event(value);update({path});navigate(path);};
  const change=(patch:Partial<TaskState>,value:UIEvent)=>{event(value);update(patch);};
  const remaining=[state.prototype,state.docs,state.publish].filter(value=>!value).length;
  return <Screen>
    <Output id="route" label="当前页面" value={state.path}/>
    <Action id="nav-home" label="首页" onTrigger={value=>go('/',value)}/>
    <Action id="nav-tasks" label="任务列表" onTrigger={value=>go('/tasks',value)}/>
    <Action id="nav-settings" label="设置" onTrigger={value=>go('/settings',value)}/>
    <Routes>
      <Route path="/" element={<Section title="首页"><Input id="name" label="称呼" value={state.name} onChange={value=>change({name:String(value.after)},value)}/><Text>今天还有 {remaining} 项任务待完成。</Text></Section>}/>
      <Route path="/tasks" element={<Section title="任务列表">
        <Check id="prototype" label="完成原型" checked={state.prototype} onChange={value=>change({prototype:Boolean(value.after)},value)}/>
        <Check id="docs" label="编写文档" checked={state.docs} onChange={value=>change({docs:Boolean(value.after)},value)}/>
        <Check id="publish" label="发布 npm" checked={state.publish} onChange={value=>change({publish:Boolean(value.after)},value)}/>
      </Section>}/>
      <Route path="/settings" element={<Section title="设置">
        <Check id="notifications" label="启用通知" checked={state.notifications} onChange={value=>change({notifications:Boolean(value.after)},value)}/>
        <Select group="theme" value={state.theme} options={[{id:'dark',label:'Dark',value:'dark'},{id:'light',label:'Light',value:'light'}]} onSelect={value=>{if(value.after==='light'||value.after==='dark')change({theme:value.after},value);}}/>
        <Text>主题：{state.theme==='dark'?'Dark':'Light'}</Text>
      </Section>}/>
    </Routes>
    <Block id="app-state" type="task-state" lang="json" value={json} readOnly/>
  </Screen>;
}

/** One application, one Root, one immutable Screen. React Router belongs here. */
export async function createTaskApp(host:ScreenPort,options:TaskAppOptions={}){
  const errors:Error[]=[];
  const root=await render(snapshot=>{
    const initial=stateFromSnapshot(snapshot);
    return <MemoryRouter initialEntries={[initial.path]} useTransitions={false}><TaskView initial={initial} event={value=>options.onEvent?.(value)}/></MemoryRouter>;
  },{host,screen:options.screen??taskScreenId,blockTypes:taskBlockTypes(),onError:error=>{errors.push(error);options.onError?.(error);}});
  return {root,screen:options.screen??taskScreenId,
    async idle(){await root.idle();await root.flush();await root.idle();if(errors.length)throw errors.shift()!;},
    close:()=>root.unmount(),
  };
}
