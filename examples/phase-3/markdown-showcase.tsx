import {Screen,Heading,Text,Divider,Link,Image,Code,CodeBlock,Quote,Section,List,OrderedList,ListItem,Table} from '@mineral/textui-react';

export function MarkdownShowcase() {
  return <Screen>
    <Heading>Markdown Showcase</Heading>
    <Text>Inline <Code>{'const message = "Hello"'}</Code> and <Link href="https://example.com" title="Example">a standard link</Link>.</Text>
    <Image src="https://example.com/image.png" alt="Example image"/>
    <Divider/>
    <Section title="Code and quotes" level={2}>
      <CodeBlock lang="typescript" meta="title=hello.ts">{'  console.log("Hello");\n// Content can include ``` fences.\n'}</CodeBlock>
      <CodeBlock>{'No language required.'}</CodeBlock>
      <Quote><Text>Markdown keeps its original syntax.</Text><Text>Use any Markdown editor.</Text></Quote>
    </Section>
    <Section title="Lists and table" level={2}>
      <List><ListItem>First item<OrderedList><ListItem>Nested item</ListItem><ListItem>Another item</ListItem></OrderedList></ListItem><ListItem>Second item</ListItem></List>
      <Table columns={[{key:'name',title:'Name',align:'left'},{key:'status',title:'Status',align:'center'},{key:'count',title:'Count',align:'right'}]} rows={[{name:'Server A',status:'**Online**',count:2},{name:'Server B | backup',status:'`Offline`',count:0}]}/>
    </Section>
  </Screen>;
}
