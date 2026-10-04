import {Screen,Heading,Text,Section,List,ListItem,Input,Check,Select,Action,Output,useTextState} from '@mineral/textui-react';

export function InteractiveForm() {
  const [name]=useTextState('name','June');
  const [sound]=useTextState('sound',true);
  const [theme]=useTextState('theme','dark');
  const [count,setCount]=useTextState('count',0);
  const [result,setResult]=useTextState('result','尚未提交');
  return <Screen>
    <Heading>Interactive Form</Heading>
    <Text>编辑字段并保存；勾选 Submit 提交当前表单。</Text>
    <Section title="Profile" level={2}>
      <List><ListItem><Input id="name" label="Name" value={name}/></ListItem><ListItem><Check id="sound" label="Enable sound" checked={sound}/></ListItem></List>
      <Select id="theme" stateKey="theme" group="theme" value={theme} options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]}/>
      <Action id="submit" label="Submit" onTrigger={()=>{setCount(n=>n+1);setResult(`${name}; sound=${sound}; theme=${theme}`);}}/>
      <Output id="count" label="Submissions" value={count}/>
      <Output id="result" label="Result" value={result}/>
    </Section>
  </Screen>;
}
