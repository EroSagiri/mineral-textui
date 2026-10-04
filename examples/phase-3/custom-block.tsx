import {BlockTypeRegistry} from '@mineral/textui';
import type {BlockProps} from '@mineral/textui-react';
import {Screen,Heading,Text,Block,Action,Output,Table,useTextState} from '@mineral/textui-react';

export interface Settings {message:string; enabled:boolean}
export function createSettingsTypes():BlockTypeRegistry {
  const types=new BlockTypeRegistry();
  types.register<Settings>('settings',{
    parse(text) {
      const fields=new Map<string,string>();
      for(const line of text.split(/\r?\n/)) {
        if(!line.trim() || line.trimStart().startsWith('#'))continue;
        const match=/^(message|enabled)=(.*)$/.exec(line);
        if(!match || fields.has(match[1]))throw new Error('Settings 只接受不重复的 message= 和 enabled= 字段。');
        fields.set(match[1],match[2]);
      }
      if(!fields.has('message') || !['true','false'].includes(fields.get('enabled')??''))throw new Error('Settings 需要 message 和布尔 enabled。');
      return {message:fields.get('message')!,enabled:fields.get('enabled')==='true'};
    },
    serialize(value) {
      if(/[\r\n]/.test(value.message))throw new Error('message 必须为单行。');
      return `message=${value.message}\nenabled=${value.enabled}`;
    },
    deriveEvents:(before,after)=>before.enabled===after.enabled?[]:[{kind:'enabledChanged',enabled:after.enabled}],
  });
  return types;
}
/** Application-owned component: Core has no knowledge of the settings format. */
export function SettingsBlock(props:Omit<BlockProps,'type'|'lang'>) {
  return <Block {...props} lang="textui" type="settings"/>;
}
export function CustomBlock({types}:{types:BlockTypeRegistry}) {
  const [content,setContent]=useTextState('settings',types.serialize('settings',{message:'Hello',enabled:true}));
  const [changes,setChanges]=useTextState('changes',0);
  const settings=types.parse('settings',content) as Settings;
  return <Screen>
    <Heading>Custom Block</Heading>
    <Text>修改代码块中的 message= 或 enabled= 并保存。注释与空行也是原始文本的一部分。</Text>
    <SettingsBlock id="settings" value={content} onTextChange={event=>setContent(event.after)} onEvent={()=>setChanges(n=>n+1)}/>
    <Table columns={[{key:'key',title:'Setting'},{key:'value',title:'Value'}]} rows={[{key:'message',value:settings.message},{key:'enabled',value:settings.enabled}]}/>
    <Output id="changes" label="Enabled changes" value={changes}/>
    <Action id="reset" label="Reset settings" onTrigger={()=>setContent(types.serialize('settings',{message:'Hello',enabled:true}))}/>
  </Screen>;
}
