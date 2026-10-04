import {MemoryScreen,parseTextUI,patchValues,FieldValidationException,validateField,fencedCode} from '@mineral/textui';
import {render,Screen,Input,Textarea,NumberInput,Check,Select,Action,Output,Strong,Emphasis,Strike,Text,useTextState} from '@mineral/textui-react';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
/** Same contract runs under Node, no-node-compat workerd and installed tarballs. */
export async function verifyPhase6(){
  const host=new MemoryScreen(),errors:Error[]=[],events:string[]=[];let submissions=0;
  function App(){const [name]=useTextState('name','Alpha');const [body]=useTextState('body','初始 📝\n  indented\n');const [number]=useTextState<number|null>('number',0.3);
    return <Screen><Text>ordinary **Markdown**</Text><Input id="name" value={name} label="Name" required validate={v=>({valid:v===''||v.length>=3,message:'too short'})} onChange={()=>events.push('name')}/>
      <Textarea id="body" value={body} required onChange={()=>events.push('body')}/><NumberInput id="number" label="Number" value={number} min={-1} max={10} step={0.1} required onValueChange={v=>events.push('number:'+v)}/>
      <Input id="locked" label="Locked" value="fixed" readOnly/><Action id="disabled" label="Disabled" disabled onTrigger={()=>submissions++}/>
      <Check id="check" label="Check" disabled/><Select id="sel" group="choice" value="a" disabled options={[{value:'a',label:'A'},{value:'b',label:'B'}]}/>
      <Action id="submit" label="Submit" onTrigger={()=>{assert(name==='Bravo' && number===1.2 && body==='新文本\n```\n  尾部\n','batch was not restored before Action');submissions++;}}/>
      <Output id="out" label="Out" value={name}/><Text><Strong>中文 * [x] <Emphasis>nested</Emphasis></Strong> <Strike>old</Strike></Text></Screen>;
  }
  let root=await render(<App/>,{host,screen:'form',onError:e=>errors.push(e)});
  const initial=(await host.getScreen('form'))!;
  const edit=async(text:string)=>{const current=(await host.getScreen('form'))!;await host.setScreen('form',text,{expectedRevision:current.revision});await root.idle();};
  const body='新文本\n```\n  尾部\n';
  await edit('<!-- untouched -->\n'+patchValues(parseTextUI(initial.text),new Map<string,string|boolean>([['name','Bravo'],['number','1.2'],['submit',true]])).replace(fencedCode('初始 📝\n  indented\n','textui','type=textarea id=body required=true'),fencedCode(body,'textui','type=textarea id=body required=true')));
  assert(submissions===1,'submit missing');assert(events.join(',')==='name,body,number:1.2','events must follow document order');
  assert(root.store.read('body')===body,'multiline roundtrip');assert(root.store.read('number')===1.2,'numeric state');
  assert((await host.getScreen('form'))!.text.startsWith('<!-- untouched -->'),'ordinary bytes rewritten');
  root.store.set('body','React\n``````\n ');await root.flush();await root.idle();assert(events.length===3,'React echo');
  let confirmed=(await host.getScreen('form'))!;
  const failures=[
    patchValues(parseTextUI(confirmed.text),new Map([['number','12abc']])),
    patchValues(parseTextUI(confirmed.text),new Map([['number','11']])),
    patchValues(parseTextUI(confirmed.text),new Map([['number','0.15']])),
    patchValues(parseTextUI(confirmed.text),new Map([['name','x']])),
    confirmed.text.replace('[fixed]','[edited]'),
    confirmed.text.replace('- [ ] Disabled','- [x] Disabled').replace('disabled=true','disabled=false'),
    confirmed.text.replace('- [ ] Check','- [x] Check'),
    confirmed.text.replace('(*) A','( ) A').replace('( ) B','(*) B'),
  ];
  for(const text of failures){await edit(text);assert((await host.getScreen('form'))!.text===text,'invalid bytes overwritten');assert(root.store.read('number')===1.2 && root.store.read('name')==='Bravo','state polluted');assert(events.length===3 && submissions===1,'invalid callback');await edit(confirmed.text);}
  assert(errors.length===failures.length && errors.every(e=>Boolean(e instanceof FieldValidationException)),'structured validation errors');
  await edit(patchValues(parseTextUI(confirmed.text),new Map([['number',''],['name','']])));
  assert(root.store.read('number')===null,'empty numeric value');assert(root.store.read('name')==='','required must permit editing empty');
  assert(!validateField(null,{required:true}).valid && validateField(null,{required:true},'edit').valid,'required submission semantics');
  await root.unmount();root=await render(<App/>,{host,screen:'form',onError:e=>errors.push(e)});
  assert(root.store.read('number')===null && root.store.read('name')==='','empty restart state');
  assert(root.store.read('body')==='React\n``````\n ','textarea restart');
  root.store.set('number',0);await root.flush();assert(parseTextUI((await host.getScreen('form'))!.text).controls.get('number')!.value==='0','zero controlled update');
  await root.unmount();return {ok:true,textarea:true,number:true,validation:true,disabled:true,readOnly:true,restart:true,batch:true};
}
