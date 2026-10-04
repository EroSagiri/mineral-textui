# Phase 3：组件与自定义控件

基础组件全部从 `@mineral/textui-react` 导入。Core 负责 Markdown 和协议，React 只访问注入的 ScreenPort；Node Host 接口保持不变。

## Markdown 组件

| 组件 | 属性与用法 |
| --- | --- |
| Screen | `children`，根容器 |
| Heading | `level={1..6}`，行内 children |
| Text | 行内 children，可组合 Link、Image、Code；字符串允许 Markdown 行内格式 |
| Divider | 标准 `---` |
| Link | `href`、可选 `title`、行内 children |
| Image | `src`、可选 `alt` 和 `title` |
| Code | 行内代码，自动选择反引号长度 |
| CodeBlock | 可选 `lang`、`meta`，children 为代码字符串 |
| Quote | 块级 children，多行引用 |
| Section | `title`、可选 `level`、块级 children |
| List / OrderedList | ListItem children；OrderedList 可指定正整数 `start` |
| ListItem | 文本、块级内容、嵌套列表或交互控件 |
| Table | `columns`、`rows`；列包含 `key`、`title`、可选 `align` |

```tsx
<Screen>
  <Heading level={2}>Servers</Heading>
  <Text>Read <Link href="https://example.com">the docs</Link>.</Text>
  <CodeBlock lang="typescript" meta="title=hello.ts">
    {'  console.log("Hello");\n'}
  </CodeBlock>
  <List>
    <ListItem>Parent<List><ListItem>Child</ListItem></List></ListItem>
  </List>
  <Table
    columns={[{key: 'name', title: 'Name'}, {key: 'state', title: 'Status', align: 'center'}]}
    rows={[{name: 'Server A | backup', state: '**Online**'}]}
  />
</Screen>
```

CodeBlock 保留换行、缩进和特殊字符，围栏长于内容中的反引号串。`lang` 可以是任意单个语言标记，也可以省略。meta 不允许换行和反引号。含 `type=` / `id=` 的围栏元数据属于 Block 协议；普通代码示例应使用其他 meta 名称。代码不会被执行。

Table 的单元格是单行 Markdown，支持 `**强调**`、行内代码、链接及转义竖线。裸竖线自动转义，已有 `\|` 保持有效；需要多行或交互表格时由应用使用组件组合或自定义 Block。Table 不排序、筛选或分页。

## 交互与持久身份

Input / Check / Select / Action / Output 保持已有 API，事件分别为 `change`、`change`、`select`、`trigger`；Output 为只读应用输出。事件包含 `target`，change / select 另有 `before`、`after`。Select 回调使用应用的选项 value。

`useTextState` 保存字符串、布尔或有限数字。控件通过 `stateKey` 绑定，或者使用与状态键相同的显式 ID。外部编辑先恢复同批全部字段，再按文档顺序派发同步回调。没有变化的 flush 不创建新版本。Action 执行后复位，重复通知和自身回写不会再次触发。

```tsx
function Tasks({items}: {items: {id: string; label: string}[]}) {
  return <List>{items.map(item =>
    <ListItem key={item.id}>
      <Check id={`task.${item.id}`} label={item.label} />
    </ListItem>
  )}</List>;
}
```

React key 只协调 React 节点，不自动生成 Markdown ID。省略 ID 时，普通控件由类型、标签、分组唯一识别，Block 由类型和语言唯一识别；重复身份报错。重命名、重排和跨重启恢复应使用显式 ID，ID/type/group 只允许字母、数字、下划线、点、连字符。控件与 Block 共享屏幕 ID 命名空间。

列表和引用内的控件支持局部值更新。动态列表结构变更只在能唯一定位已确认结构时应用；列表内新增的用户文字、改动的排版或位置歧义会阻止结构重写。文件外部的无关文字、注释和空行保留。文本冲突报告到 `onError`；失效版本通过 ScreenConflictError 拒绝，应用不能强行覆盖。

## 组合自定义控件

Block 是应用扩展入口，不解释 value 中的内容。无需注册解析器即可订阅原始文本修改。

```tsx
import {Block, useTextState} from '@mineral/textui-react';

function NoteEditor() {
  const [content, setContent] = useTextState('note', 'message=Hello');
  return <Block
    lang="textui" type="note" id="note" value={content}
    onTextChange={event => setContent(event.after)}
  />;
}
```

输出：

````md
```textui type=note id=note
message=Hello
```
````

`lang` 默认 textui，也可使用应用自己的语言标记；type 必填，id 可选。value 必须为字符串。Block 可以放入 Section、Quote 或 ListItem。外部修改按稳定身份映射成 `textChange`，before / after 为原始内容字符串。React 自己的更新不会派发此事件。

持久 Block 使用 `useTextState` 和显式 ID/stateKey，启动时从文件恢复内容；使用普通 `useState` 的受控 Block 通过 `onTextChange` 接收运行中的编辑，启动值由应用决定。处理器必须同步；临时 React 状态和外部副作用不参与事务回滚。

未注册类型照样解析、写回并保留原始文本。Core 的 `parseTextUI(text).blocks` 提供语言、类型、ID、内容以及原文 start/end、fullStart/fullEnd 范围。嵌套列表/引用的内容去除 Markdown 容器前缀，范围始终指向原文。

## 可选类型注册

```ts
import {BlockTypeRegistry, registerBlockType} from '@mineral/textui';

const types = new BlockTypeRegistry();
const unregister = types.register('settings', {
  parse: text => JSON.parse(text),
  serialize: value => JSON.stringify(value, null, 2),
  deriveEvents: (before, after) =>
    before.enabled === after.enabled ? [] : [{kind: 'enabledChanged', enabled: after.enabled}],
});

// 由应用决定何时把业务数据转换成字符串：
const content = types.serialize('settings', {enabled: true});
const data = types.parse('settings', content);
// await render(<App />, {host, screen: 'home', blockTypes: types});
// unregister();
```

`parse` 和 `serialize` 必填，`deriveEvents` 可选、同步返回事件数组。同一 registry 重复注册报错；返回的注销函数可重复调用。`registerBlockType(type, codec)` 是默认共享 registry 的便捷入口。多个应用或 Worker 请求建议使用独立 BlockTypeRegistry 并传给 render，避免共享注册配置。

运行时在初始化、外部编辑和提交前校验已注册类型。校验失败时不派发该批事件、不覆盖用户文件。语义变更在原始 `textChange` 之后派发为 `{type:'blockEvent', target, event}`，Block 用 `onEvent` 接收应用定义的载荷。单独使用 Core 时，可以调用 `semanticDiff(before, after, protocolOptions, types)` 派生事件。

注册器不会自动把对象放进 Block.value；应用使用 `types.serialize` 生成字符串，使用 `types.parse` 获取业务数据，保持文本协议与应用格式的责任边界。

## 可运行示例与验收

```sh
pnpm markdown-showcase
pnpm interactive-form
pnpm custom-block
# 可指定路径：
pnpm phase3 custom-block ./screens/my-settings.md
```

三个应用位于 `examples/phase-3/`。默认写入对应的 screens Markdown，Ctrl+C 保存并退出。Custom Block 用应用定义的 `message=` / `enabled=` 格式，展示组合组件、私有 registry、原始编辑、派生事件、React 重置和重启恢复。

```sh
pnpm check
pnpm test
pnpm test:workers
```

类型检查和包边界检查之外，Vitest 验证 Markdown 输出、围栏、嵌套控件、动态列表、Block 事件、原文保留、错误和重启。Workers 测试在禁用 Node compatibility 的本地真实 workerd 中运行表单、Markdown Showcase 和 Custom Block，没有新增 Host 方法或云端部署。
