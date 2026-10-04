# TextUI 公共组件 API（0.0.0）

本参考覆盖准备稳定的三个 npm 包。运行环境为 React 19.3.0、无 DOM 的 React Runtime；Core 不依赖 React 或 Host。首次包版本用于真实应用验证，尚未承诺 1.0 稳定性。

## 组件属性与输出

以下 `children` 默认省略，类型为 ReactNode；CodeBlock 是例外，必须提供字符串正文。`id`、`stateKey` 默认省略。`disabled`、`readOnly`、`required` 默认 false；显式提供的布尔值序列化为 true/false。元数据不保存 stateKey、函数、React key 或运行时对象。

| 组件 | 属性（未标 ? 的必填） | 默认与 Markdown 输出 |
| --- | --- | --- |
| Screen | id?, children? | 单应用文档容器；一个 Root 至多一个显式 Screen，禁止嵌套；id 不替代固定 render.screen |
| Heading | level?: 1–6, children? | level=1，`# 文本` |
| Text | children? | 原有 Markdown 字符串直接输出，保持兼容 |
| Strong | children? | `**文本**`，文本子节点转义 Markdown 特殊字符 |
| Emphasis | children? | `*文本*`，同上 |
| Strike | children? | `~~文本~~`，GFM 删除线 |
| Link | href: string, title?, children? | `[标签](<地址> "title")`，省略 title 时不输出标题 |
| Image | src: string, alt?, title? | `![alt](<地址>)`，alt 默认空串 |
| Code | children? | 行内代码，围栏自动加长，正文只取文本 |
| CodeBlock | children: string, lang?, meta? | lang/meta 默认空串，代码围栏自动加长 |
| Divider | 无 | `---` |
| Quote | children? | 每行加 `> ` |
| Section | title: string, level?: 1–6, children? | level=1，标题后接子内容 |
| List | children?: ListItem | `- 项目`，支持嵌套 |
| OrderedList | start?: number, children?: ListItem | start=1，必须为正整数 |
| ListItem | children? | 必须在 List/OrderedList 内，可组合交互组件 |
| Table | columns, rows | GFM 表格，列 key 必须唯一，管道字符转义 |
| Input | label: string, value: string, id?, stateKey?, disabled?, readOnly?, required?, validate?, onChange? | `Label: [值] <!-- textui:type=input ... -->`，单行，支持 `\]`/`\\` |
| Check | label: string, checked?: boolean, id?, stateKey?, disabled?, readOnly?, required?, onChange? | checked=false，`- [ ] Label <!-- textui:type=check ... -->` |
| Select | group: string, value: string\|null, options, id?, stateKey?, disabled?, readOnly?, required?, onSelect? | `(*) Label <!-- textui:type=select group=g ... -->`；一个 group 只能对应一个 Select |
| Action | label: string, id?, stateKey?, disabled?, readOnly?, required?, onTrigger? | `- [ ] Label <!-- textui:type=action ... -->`；勾选派发后自动复位，不绑定持久状态 |
| Output | label: string, value: string\|number\|boolean, id?, stateKey? | `Label: 值 <!-- textui:type=output ... -->`，始终只读 |
| Textarea | value: string, label?, id?, stateKey?, disabled?, readOnly?, required?, validate?, onChange? | label 省略时无标题；否则 `## Label`；正文使用 `textui type=textarea` 围栏 |
| NumberInput | label: string, value: number\|null, min?, max?, step?, id?, stateKey?, disabled?, readOnly?, required?, validate?, onValueChange? | `Label: [数字] <!-- textui:type=number ... -->`，null 输出空括号 |
| Block | type: string, value: string, lang?, id?, stateKey?, disabled?, readOnly?, required?, onTextChange?, onEvent? | lang=textui，围栏包含 type 和可选 id；约束沿用通用交互语义 |

Table.columns 为 `{key:string,title:string,align?:'left'|'center'|'right'}[]`，align 省略时为默认对齐；rows 为只包含 string/number/boolean/null/undefined 的记录数组。Select.options 为 `{label:string,value:string,id?:string}[]`，值必须唯一；每项显式 id 优先，否则由 Select id 和 option value 组合。没有显式 id 时按类型、标签和 group 派生身份。

Strong/Emphasis/Strike 支持嵌套以及 Link、Code、Image 组合；空内容不生成分隔符，同类嵌套与相邻格式合并。格式内部的字符串作为文字转义；Text 在格式外的旧 Markdown 字符串仍按原样输出。需要段落、表格等块内容时使用相应组件，勿放入行内格式。

Textarea 保留原始换行、缩进、Unicode 和尾部空白。它复用 Block 解析、局部更新和 textChange，不创建另一条事件总线。内容包含反引号时自动增加围栏长度；手工编辑必须让结束围栏不短于开始围栏，内容中的围栏短于开始围栏。未闭合或提前闭合后留下的损坏围栏会报错并保留原文。

## 身份和受控状态

`render` 接受 ReactNode 或 `AppInitializer = (snapshot: ScreenSnapshot|null) => ReactNode`。初始化函数在订阅建立并读取最新文档后调用一次；框架不解释路径。应用可使用 React Router 的 MemoryRouter，在 Action 的同步 onTrigger 中调用 useNavigate。页面变化更新固定 Screen 的 Section；外部修改无法安全合并时保留原文并报错。Section 外备注保留。路由和未展示字段的持久模型由应用保存到绑定 Block。

id 可选，但只允许字母、数字、下划线、点和连字符。重复 id、同类型同标签或同类型 Block 的隐式身份歧义会报错。React key 仅参与 React 列表协调，不会变成 TextUI id。动态列表、跨重启字段应使用显式 id。

`useTextState(key, initial)` 通过当前 Root 的 Store 保存状态。组件使用 stateKey 绑定；省略时，同名显式 id 在 Store 中存在即可绑定。所有持久状态必须绑定控件或 Block；Output 可以保存结果/计数。普通 useState 也可用于受控组件，但不能替代持久绑定，回调应主动 setState。NumberInput 建议 `useTextState<number|null>('n', 3)`；null 是空数值，不是字符串空串。数字始终必须有限。

```tsx
const [message, setMessage] = useTextState('message', '');
const [count, setCount] = useTextState<number | null>('count', 0);
return <Screen>
  <Textarea id="message" value={message} onChange={e => setMessage(e.after)} />
  <NumberInput id="count" label="Count" value={count} step={0.1} onValueChange={setCount} />
</Screen>;
```

## 事件与事务顺序

Core 的 UIEvent 保持兼容：change.after/before 为 string|boolean；select.after/before 为 string|null；trigger 只有 target；textChange 前后值为字符串；blockEvent.event 为应用自定义值。NumberInput 在底层发 string change，React 转换后仅调用 onValueChange(number|null)。Textarea.onChange 接收 textChange，仍可通过 Core 观察原事件。

外部通知会重新读取最新 snapshot，在串行事务中：解析全部文本及已注册 Block → 按已确认协议检查约束/身份 → 归一化 Select → 校验修改字段 → 恢复同批全部持久状态 → React 重渲染 → 检查当前组件是否允许所有事件 → 按文档顺序同步派发回调 → 局部合并并按 revision 条件写入。一个 Block 的 textChange 在其派生 blockEvent 前。Action 回调因此可以读取同批已恢复的全部值。

回调必须同步完成；返回 Promise 会报错，异步失败也进入 onError。需要异步业务时由应用安排后台工作，服务端重新检查业务条件并更新状态。React 自身回写不会重复派发用户事件。版本竞争由 ScreenConflictError 拒绝，再读取新文本处理；普通 Markdown 使用原文范围局部合并，不重排整篇文件。无法安全合并时保留用户文本。

## 校验与错误反馈

`parseNumberText(text): number|null` 接受整数、小数、负数、零和十进制科学计数法；使用 `.`，不依赖 locale。拒绝前后空格、十六进制、逗号、NaN、Infinity、溢出和部分解析。React 输出使用 String(number)，负零规范化为零。min/max 默认为不设限制，step 默认为不设限制；step 必须正数，基点为 min 或 0，使用有上限的浮点容差。

`validateField(value, options, phase='submit'): ValidationResult` 支持 required、范围、step 和自定义 validate。`ValidationResult` 是 `{valid:boolean,message?:string}`；Input/Textarea 的 validate 参数是 string，NumberInput 是 number|null。运行时函数不写入 Markdown。

编辑阶段仅跳过 required，自定义校验仍会执行，可由应用允许暂时空值。required 只是元数据与提交校验，Check/Select/Action 不会自动拦截提交；Check 可用 validateField(checked, {required:true}) 验证必须勾选，Select 可验证 string|null，Action 由应用检查业务条件。提交时调用 validateField（默认 submit），或自己的业务验证，然后决定是否执行。disabled/readOnly 不允许通过文本修改更新状态，外部删除或篡改约束也会拒绝；React 可以改变这些属性。

`FieldValidationException extends ProtocolError` 实现 `FieldValidationError`，包含 target、code、message 和可选 start/end（原文 UTF-16 偏移）。常见 code：parse、validation、validator（自定义函数抛错）、disabled、readOnly、metadata。解析身份损坏或结构冲突仍可能是 ProtocolError。通过 render.onError 接收；启动时非法持久文本会拒绝 render。

运行时字段失败阻止整批事件和提交，不更新已确认持久状态，不覆写非法文本。Root 在修复保存前阻止写入；恢复最后确认文本也能解除阻塞。应用可在终端显示错误，用户修复后再把错误状态写入 Output；不要在错误处理器中尝试覆盖仍被阻塞的文件。

```tsx
const result = validateField(name, {required: true, validate: v => ({
  valid: v.length >= 3, message: '至少三个字符'
})});
if (!result.valid) { setResult(result.message ?? '无效'); return; }
// 此处继续检查权限及业务条件。
```

disabled/readOnly/required 是协议交互语义，不是身份验证。部署、删除等操作仍由真正执行操作的服务端检查权限。

## 自定义 Block

```ts
const types = new BlockTypeRegistry();
types.register('settings', {
  parse: text => JSON.parse(text),
  serialize: value => JSON.stringify(value),
  deriveEvents: (before, after) => [{before, after}]
});
// render(<Block id="settings" type="settings" value={json}
//   onTextChange={e => setJson(e.after)} onEvent={handleEvent}/>,
//   {host, screen:'settings', blockTypes:types});
```

可为每个 Root 注入独立 registry，避免全局类型冲突。未知 type 仍保留原始字符串。Codec 必须同步、可验证；注册返回注销函数。公开 ScreenPort 没有增加方法。

## Runtime 与 Host

`render(app, {host, screen, onError?, blockTypes?})` 返回 RunningRoot：store、getTree()、update(app)、flush()、idle()、unmount()。后三项及 update 为 Promise；idle 等待已入队事务，unmount 保存已确认状态并释放订阅和 React effects，可重复调用。

Node 独立应用安装三个包及 React，注入 `createNodeHost(directory)`：

```tsx
import {createNodeHost} from '@mineral/textui-host-node';
import {render, Input} from '@mineral/textui-react';
const host = createNodeHost('./screens');
const root = await render(<Input id="name" label="Name" value="June"/>, {host, screen:'home'});
// 退出：await root.unmount(); await host.close();
```

Workers 独立应用只安装 Core、React 包及 React，注入 ScreenPort。最小内存应用：

```tsx
import {MemoryScreen} from '@mineral/textui';
import {render, NumberInput} from '@mineral/textui-react';
export default {async fetch() {
  const host = new MemoryScreen();
  const root = await render(<NumberInput label="Count" value={0}/>, {host, screen:'home'});
  try {return new Response((await host.getScreen('home'))!.text);}
  finally {await root.unmount();}
}};
```

MemoryScreen 不持久保存跨请求数据。仓库 examples/worker-app 展示 SQLite ScreenPort、运行时重建、编辑请求和 WebSocket；examples/worker-animation 保留现有实验帧流。独立 tarball 消费者测试验证安装包后的 JSX 应用在关闭 Node 兼容模式的 workerd 中运行。

## 迁移与实验接口

Input/Check 的 change 回调参数未改，Select/Action/Block 事件未改，Text 的原有字符串输出未改，ScreenPort 和 Frame Stream 行为未改。新增属性省略时不会输出额外元数据。

CodeBlock.children 收紧为必填 string；此前传 React 元素的代码需先转换为字符串。StateValue 增加数字空值 null；采用穷举类型判断的消费者应补充 null 分支。NumberInput 使用严格十进制文本格式，旧 Input 的数字状态恢复规则保留。NumberInput 允许清空，应使用 nullable 状态与回调。

本次准备稳定的范围为组件、事件、持久 Hook 和原有 ScreenPort。examples 中的 FrameStream、TextFrame、动画调度/应用管理没有作为公共稳定 API 导出。可选 ScreenDirectory/ScreenLifecycle/ScreenPatch/ScreenChangeFeed 仍只是扩展契约，没有扩展必需 ScreenPort。
