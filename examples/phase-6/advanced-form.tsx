import {Screen,Heading,Input,Textarea,NumberInput,Check,Action,Output,useTextState} from '@mineral/textui-react';
import {validateField} from '@mineral/textui';
export function AdvancedForm(){
  const [name,setName]=useTextState('name','Build project');
  const [retries,setRetries]=useTextState<number|null>('retries',3);
  const [description,setDescription]=useTextState('description','构建并测试项目。');
  const [approved]=useTextState('approved',true);
  const [result,setResult]=useTextState('result','尚未提交');
  return <Screen><Heading>Task Configuration</Heading>
    <Input id="name" label="Name" value={name} required onChange={e=>setName(String(e.after))}/>
    <NumberInput id="retries" label="Retries" value={retries} min={0} max={10} step={1} required onValueChange={setRetries}/>
    <Textarea id="description" label="Description" value={description} onChange={e=>setDescription(e.after)}/>
    <Input id="owner" label="Owner" value="Local application" readOnly/>
    <Check id="approved" label="Enable submission" checked={approved}/>
    <Action id="submit" label="Submit" disabled={!approved} onTrigger={()=>{
      const errors=[validateField(name,{required:true}),validateField(retries,{required:true,min:0,max:10,step:1})].filter(v=>!v.valid);
      setResult(errors.length?errors.map(v=>v.message).join(' '):`已提交 ${name}，重试 ${retries} 次，描述 ${description.length} 字符。`);
    }}/><Output id="result" label="Result" value={result}/>
  </Screen>;
}
