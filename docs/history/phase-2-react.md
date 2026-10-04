# Mineral TextUI：Phase 2 开发说明

**阶段：React Runtime & Markdown Renderer**

**目标：** 将现有 TextUI 引擎升级为 React 驱动的声明式文本 UI 框架，实现基础控件、事件处理、Markdown 渲染及外部文本双向同步。

## 一、设计原则

1. **React 是应用层。** 开发者使用 JSX、组件和 Hooks 描述界面及业务逻辑。
2. **纯文本是持久化协议。** React 的内部组件树和事件处理函数不需要写入文件，所有需要保留的业务状态都必须能够从文本恢复。
3. **不绑定编辑器。** 不依赖 DOM、浏览器、Obsidian、VS Code 或终端 API。
4. **保留现有 Screen 引擎。** 继续使用现有文件读写、监听和回环保护机制，并补足并发写入安全性。
5. **优先兼容 Markdown。** 尽可能使用现有 GFM 语法。TextUI 特有的控件语义，通过 HTML 注释补充。

本阶段暂不实现导航系统、网络同步、动画和复杂布局，但数据结构应允许以后扩展这些功能。

## 二、整体架构

```text
React Application
       |
       | JSX / Hooks
       v
React Reconciler
       |
       | 创建、更新、删除节点
       v
TextUI Host Tree
       |
       +-------------------------+
       |                         |
       v                         v
Markdown Renderer           Component Registry
       |                         |
       v                         |
   Screen Engine                 |
       |                         |
       v                         |
   Markdown File                 |
       |                         |
       | 文件被外部修改           |
       v                         |
Markdown Parser                 |
       |                         |
       v                         |
Semantic Diff                   |
       |                         |
       v                         |
   Event Dispatcher ------------+
       |
       v
React Event Handlers
       |
       v
State Update → React Commit → Markdown
```

React Reconciler 只负责维护内存中的组件树。

禁止在 React 的 render 阶段直接操作磁盘。所有文件写入必须在 React 提交更新之后，经由统一的 Screen 写入通道完成。

## 三、React 集成

### 3.1 技术选型

- React：组件、Hooks、状态与更新调度。
- `react-reconciler`：自定义文本渲染器。
- TypeScript：组件属性和内部节点类型。
- `unified`、`remark-parse`、`remark-gfm`：Markdown 解析。
- 现有 Screen：文件 IO、监听和回环控制。
- Vitest：单元及端到端测试。

锁定 React 和 react-reconciler 的兼容版本，不使用浮动依赖。可选用兼容组合 React 19.3.0 与 react-reconciler 0.34.0，并在安装时核对 peerDependencies。

### 3.2 自定义 Host Tree

第一版采用 mutation 模式，在内存中维护一个轻量级节点树。

```ts
interface TextNode {
  kind: "text";
  value: string;
}

interface ElementNode {
  kind: "element";
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
}

type HostNode = TextNode | ElementNode;
```

实现当前版本 HostConfig 所需的实例创建、文本创建、子节点插入、更新、删除、提交等接口。

组件更新时，Reconciler 更新 Host Tree。Markdown Renderer 根据提交后的树生成文本变更，再由 Screen 写入文件。

对外提供：

```tsx
render(<App />, {
  file: "./user.md"
});
```

另外提供 `unmount()`，用于释放文件监听器、React Root 和事件订阅。

## 四、基础组件

本阶段实现六种基础控件及两个结构组件。

| React 组件 | Markdown 形式 | 功能 |
|---|---|---|
| Heading | `# User` | 标题 |
| Text | 普通 Markdown 文本 | 静态内容 |
| Input | `Name: [June]` | 文本输入 |
| Check | `- [x] Sound` | 布尔状态 |
| Select | `( ) Light` | 单选 |
| Action | `- [ ] Submit` | 一次性操作 |
| Output | `Result: OK` | 只读输出 |
| Screen | 文档根节点 | 一个独立文本屏幕 |

Heading 和普通 Text 不需要 TextUI 注释。其余控件必须生成 `type` 元数据。

### 4.1 控件协议

统一使用：

```md
<!-- textui:id=xxx type=xxx -->
```

属性规则：

- `type`：必填，标识控件类型。
- `id`：可选，提供持久稳定的控件身份。
- `group`：可选，用于组合 Select 控件。

当同一个屏幕存在两个相同类型、相同标签的控件时，必须提供不同的 ID。

没有显式 ID 的控件，只允许在当前屏幕内能够被唯一识别的情况下使用。修改其标签可能改变身份；需要稳定身份的组件应主动提供 ID。

一旦出现重复 ID 或无法消除的身份歧义，应报告明确错误，不得猜测用户操作了哪个控件。

### 4.2 组件语义

**Input**

修改方括号中的值会产生 `change` 事件。第一版实现单行输入，支持转义 `]` 和反斜杠，暂不支持多行。

**Check**

支持勾选与取消勾选，两者均产生 `change` 事件。使用标准 GFM 任务列表格式。

**Select**

同一个 `group` 内只能选择一个选项。切换选项时，派发一次包含新旧选择值的事件。

**Action**

采用复选框作为纯文本操作入口。检测到未选中变为选中时触发 `trigger` 事件，处理成功后自动复位。重复读取同一个文件状态不得重复执行。

Action 的一次性事件与 Check 的持久布尔状态必须明确区分。

**Output**

由应用更新，只读。外部修改不应产生用户输入事件。第一版可在检测到非法修改后，报告诊断信息并恢复应用定义的值。

## 五、事件系统

通过组件属性定义事件处理函数，并由 Event Dispatcher 将外部文本变更映射到对应组件。

```ts
type UIEvent =
  | {
      type: "change";
      target: string;
      before: string | boolean;
      after: string | boolean;
    }
  | {
      type: "select";
      target: string;
      group: string;
      before: string | null;
      after: string;
    }
  | {
      type: "trigger";
      target: string;
    };
```

`target` 使用显式 ID；未提供 ID 时使用运行时解析出的唯一身份。

第一版对外提供：

- `onChange`：Input、Check。
- `onSelect`：Select。
- `onTrigger`：Action。

处理流程：

1. Screen 检测外部文件变化。
2. Parser 生成最新控件状态。
3. Semantic Diff 对比已确认的上一个状态。
4. Event Dispatcher 根据控件身份派发事件。
5. 对应的 React 事件处理函数执行。
6. 状态变化触发 React 更新。
7. Markdown Renderer 生成新的文本。
8. Screen 写回文件。

事件顺序应与一次文件事务中的变更顺序一致。同一个文件变更批次产生的事件应采用明确、可测试的派发规则。

Action 复位必须避免回环和重复触发。暂不承诺跨进程崩溃的严格 exactly-once 语义。

## 六、React 状态管理

普通 `useState` 可以管理临时 UI 状态，但需要持久化或允许外部文件修改的字段，必须通过 TextUI Store 管理。

提供基础 Hook：

```ts
const [value, setValue] =
  useTextState("field-key", initialValue);
```

要求：

- 初次启动且文件不存在时，采用默认值生成文档。
- 文件已经存在时，优先读取合法的持久状态，而不是让组件默认值覆盖用户修改。
- 外部文件变化时，更新 Store 并通知相应的 React 组件。
- React 内部更新时，通过 Renderer 写回文本。
- 防止同一次更新在文件与 React 之间反复循环。

可使用 `useSyncExternalStore` 连接 TextUI Store 与 React。

`field-key` 是应用内部的状态键，不等同于必须写入 Markdown 的控件 ID。

## 七、Markdown Renderer

实现：

```ts
serialize(
  root: ElementNode
): string;
```

以及处理外部文本的：

```ts
parseTextUI(
  markdown: string
): ParsedScreen;
```

首先支持上述基础组件，不必立即实现完整的 Markdown 双向排版编辑器。

### 7.1 输出规则

以下 JSX：

```tsx
<Screen id="user">
  <Heading level={1}>User</Heading>

  <Input label="Name" value="June" />

  <Check label="Enable sound" checked />

  <Select
    group="theme"
    value="dark"
    options={[
      { label: "Light", value: "light" },
      { label: "Dark", value: "dark" }
    ]}
  />

  <Heading level={2}>主表单</Heading>

  <Action id="submit-main" label="Submit" />

  <Heading level={2}>预览表单</Heading>

  <Action id="submit-preview" label="Submit" />

  <Output label="Result" value="尚未提交" />
</Screen>
```

应生成：

```md
# User

Name: [June] <!-- textui:type=input -->

- [x] Enable sound <!-- textui:type=check -->

( ) Light <!-- textui:type=select group=theme -->
(*) Dark <!-- textui:type=select group=theme -->

## 主表单

- [ ] Submit <!-- textui:id=submit-main type=action -->

## 预览表单

- [ ] Submit <!-- textui:id=submit-preview type=action -->

Result: 尚未提交 <!-- textui:type=output -->
```

`id` 在提供时必须原样输出。属性顺序采用统一的规范化格式，但 Parser 应允许不同的合法属性顺序。

### 7.2 更新策略

Renderer 首先生成内存中的目标文本，不能在每次 React render 时直接覆盖整个文件。

本阶段至少支持：

- 为生成的新文件写入完整 Markdown。
- 对已经存在的控件进行基于原文范围的局部修改。
- 保存普通 Markdown 内容和非 TextUI 注释。
- 外部文件版本改变时重新读取并检查冲突。
- 冲突无法安全合并时报告错误，不静默覆盖用户编辑。

解析器应保留控件在原始文本中的位置范围，便于局部修改。不要假设 Markdown AST 重新序列化能够保持原来的空白、换行和排版。

## 八、演示应用

使用同一个 React 应用生成 User 表单。

应用需要包含：

- 一个 Name 输入框。
- 一个 Enable sound 复选框。
- 一组 Light/Dark 单选选项。
- 两个标签都叫 Submit、但 ID 不同的操作按钮。
- 两个独立提交计数器。
- 一个显示最近提交信息的 Result 输出字段。

两处 Submit 分别更新自己的计数器，执行成功后自动复位。

用户在外部编辑器修改 Name、Sound 或 Theme 并保存后，应用必须收到相应事件并更新 React 状态。

在程序停止并重新启动之后，应能够从现有文件恢复输入值、单选结果和提交计数。

## 九、建议代码结构

```text
src/
├── core/
│   ├── screen.ts
│   ├── store.ts
│   └── events.ts
├── markdown/
│   ├── parser.ts
│   ├── serializer.ts
│   ├── patch.ts
│   └── schema.ts
├── react/
│   ├── reconciler.ts
│   ├── host-config.ts
│   ├── renderer.ts
│   ├── components.tsx
│   └── hooks.ts
└── index.ts

examples/
└── user-form/

tests/
├── renderer.test.ts
├── parser.test.ts
├── events.test.ts
├── state.test.ts
└── integration.test.ts
```

保留原有项目结构中已经有效的实现，不为了匹配新目录而无意义地重写代码。

## 十、实现顺序

1. **接入 React Reconciler。** 先支持纯内存 Host Tree，验证 React 组件创建、属性更新、Hooks 和组件卸载。
2. **实现 Markdown Serializer。** 能从组件树生成完整的 Markdown，包括全部基础控件及规范化注释。
3. **实现 Parser 和控件注册表。** 从 Markdown 恢复控件状态、身份和位置，并关联正在运行的 React 组件。
4. **连接事件系统。** 外部修改 Input、Check、Select 和 Action 时，能够调用 JSX 中声明的事件处理函数。
5. **实现持久状态与反向更新。** 接入 TextUI Store，完成 React、Markdown 和文件之间的双向闭环。
6. **完善局部更新与错误处理。** 保留普通文本，检测重复 ID、无效值、并发修改和写入冲突。
7. **完成 User 表单演示及自动化测试。**

## 十一、验收标准

- [ ] 可以用 JSX 创建完整的 TextUI 页面。
- [ ] 支持 Heading、Text、Input、Check、Select、Action、Output 和 Screen。
- [ ] React Hooks 能正常工作，状态更新后生成正确 Markdown。
- [ ] Markdown 只给必要的控件添加 `type`、可选 `id` 和其他属性。
- [ ] 两个同名 Submit 通过 ID 独立工作。
- [ ] 外部修改文件能调用对应的 React 事件处理函数。
- [ ] Check 可以双向切换，Select 保持组内互斥。
- [ ] Action 成功触发后自动复位，不因重复文件事件而再次触发。
- [ ] React 更新不会导致文件监听回环。
- [ ] 普通 Markdown 内容不会被无关的控件更新删除。
- [ ] 非法输入、身份冲突和写入冲突有明确错误。
- [ ] 程序重新启动后能从文本恢复持久状态。
- [ ] 全部功能在纯 Node.js 环境运行，不需要 DOM 或任何编辑器插件。

**阶段完成的标志：** 开发者可以通过 React JSX 定义交互界面，Mineral TextUI 将其渲染为可读写的 Markdown；用户在任意文本编辑器修改并保存文件，即可驱动 React 应用，应用更新又能可靠地反映回同一份文本。
