import {Screen,Heading,Text,Strong,Emphasis,Strike,Link,Image,Code,List,ListItem,Table,Input,useTextState} from '@mineral/textui-react';
export function InlineMarkdownShowcase(){const [status]=useTextState('status','在线 🚀');return <Screen>
  <Heading>Inline Markdown Showcase</Heading><Input id="status" label="Status" value={status}/>
  <Text>Server: <Strong>{status}</Strong> <Emphasis>Updated recently</Emphasis> <Strike>Offline</Strike></Text>
  <Text><Strong>特殊字符 * [ ] _ ~ <Emphasis>嵌套格式</Emphasis> <Link href="https://example.com"><Code>{'a`b'}</Code></Link></Strong></Text>
  <Image src="https://example.com/status.png" alt="Status"/>
  <List><ListItem><Strong>Strong</Strong></ListItem><ListItem><Emphasis>Emphasis</Emphasis></ListItem></List>
  <Table columns={[{key:'format',title:'Format'},{key:'example',title:'Example'}]} rows={[{format:'Strong',example:'**在线**'},{format:'Strike',example:'~~离线~~'}]}/>
</Screen>;}
