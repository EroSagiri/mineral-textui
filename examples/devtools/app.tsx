import {Input,Action,Output,useTextState,Block} from '@mineral/textui-react';
export default function App(){
  const [name]=useTextState('name','June');
  const [count,setCount]=useTextState('count',0);
  return <><Input id="name" label="Name" value={name} stateKey="name"/><Action id="deploy" label="Deploy" onTrigger={()=>setCount(count+1)}/><Output id="result" label="Deploys" value={count} stateKey="count"/><Block id="cpu" type="server-chart" value={'[20,50,80]'}/></>;
}
