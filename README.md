# Mineral TextUI

React 定义界面，Markdown 保存状态。用户在任意文本编辑器修改控件并保存，就能驱动应用；应用更新通过注入的 ScreenPort 写回同一份文本。

## 安装与运行

开发环境：Node.js 24+、pnpm 9.15.1。

```sh
pnpm install --frozen-lockfile
pnpm start
# 浏览器编辑器（启动后自动打开，500ms 自动保存）：
pnpm devtools:examples
# 指定文件：pnpm user-form ./my-user.md
```

默认启动 React User 表单并生成 `screens/user.md`，终端会打印绝对路径。保持终端运行，在文本编辑器打开该文件，修改控件并保存。启动命令会自动构建三个包。

表单包含 Name、Enable sound、Light/Dark、两个独立 Submit、计数和最近提交结果。已有文档恢复持久状态；Ctrl+C 保存并释放订阅与 Node Host。`pnpm memory` 自动演示相同 React 表单与内存 Screen 的双向同步，然后退出；`pnpm counter` 和 `pnpm form` 分别运行纯文本应用。

完整操作步骤、生成位置和示例代码入口见 [examples/README.md](examples/README.md)。删除生成的文件后重新运行即可恢复初始状态。

通用开发工作台见 [DevTools 运行说明](devtools/README.md)：支持局部文本更新、三方合并、冲突处理、自定义 ScreenPort / Remote Bridge 连接和临时动画投影。通用开发工具包 `@mineral/textui-devtools`，测试应用位于独立示例 / 测试工程。

Phase 5 动画实验：`pnpm animation-demo` 运行可恢复的 Markdown 进度条；`pnpm worker-animation` 和 `pnpm animation-client watch` 演示按需临时帧。Frame Stream 位于示例层，ScreenPort 不变。运行说明、性能数据和技术决策见 [Phase 5 报告](docs/phase-5-animation.md)。

## 三个独立包

| 包 | 职责 | 运行时依赖 |
| --- | --- | --- |
| `@mineral/textui` | ScreenPort、Markdown 协议、解析/序列化、事件、事务、内存参考 Host | 无外部运行时依赖，解析器已打包 |
| `@mineral/textui-react` | Reconciler、JSX 组件、Hooks 与双向状态桥接 | Core、React、react-reconciler |
| `@mineral/textui-host-node` | 文件读写、不透明版本、Chokidar 监听 | Core、Node.js、Chokidar |

三个包通过各自包入口互相引用，构建为 ESM JavaScript 和类型声明。跨包不引用源码目录。原单包源码和入口已删除；历史说明保存在 `docs/history`，当前 API 以本文件及 `docs/screen-monorepo.md` 为准。

## React 与 Host 注入

```tsx
import { render, Screen, Input, Output, useTextState } from '@mineral/textui-react';
import { createNodeHost } from '@mineral/textui-host-node';

function App() {
  const [name] = useTextState('profile-name', 'June');
  return <Screen>
    <Input id="name" stateKey="profile-name" label="Name" value={name} />
    <Output label="Greeting" value={`Hello ${name}`} />
  </Screen>;
}

const host = createNodeHost('./screens');
const root = await render(<App />, { screen: 'home', host, onError: console.error });
// 生成 screens/home.md；退出时先 await root.unmount()，再 await host.close()。
```

同一个应用可以注入 `@mineral/textui` 的 `MemoryScreen` 或其他自定义 ScreenPort，React Runtime 不判断平台。`update(app)`、`flush()`、`idle()` 和 `unmount()` 返回 Promise；普通 React useState 由调度器提交后自动写回，外部文件事务中的持久状态与事件处理使用同步 React 提交。

`useTextState` 支持字符串、布尔值和有限数字。通过 `stateKey` 绑定控件，或使用与显式控件 ID 相同的内部状态键；所有持久字段必须绑定可恢复控件。Input、Check、Select 对外修改同步 Store；Output 只在启动时恢复，运行中被外部修改时报告诊断并恢复应用值。临时状态使用 useState。

## ScreenPort 契约

```ts
interface ScreenPort {
  getScreen(id: string): Promise<ScreenSnapshot | null>;
  setScreen(id: string, text: string, options: {
    expectedRevision: string | null;
    origin?: string;
  }): Promise<ScreenSnapshot>;
  onScreenChange(id: string, listener: (change: ScreenChange) => void): Promise<() => void>;
}
```

`revision` 只作相等比较。`expectedRevision: null` 只允许创建；传入已有版本只允许更新该版本，失效版本抛出 ScreenConflictError。版本检查先于相同内容判断，因此旧版本不能借由写入相同文本绕过检查。成功提交有效变更后通知当前 Host 实例订阅者；完全相同的文本允许无事件操作。创建通知的 before 使用空文本、空 revision 的合成快照，该空版本不能用于写入。

订阅完成后读取最新快照。事务串行执行，收到通知时重新读取实际 Screen，使用版本与完整内容处理重复或延迟通知；origin 不是唯一回环判断依据。Host 重连或 Root 重启必须重新读取屏幕，当前接口不提供跨进程可靠历史。

Node Host 将屏幕 ID 映射为 `<目录>/<id>.md`。ID 不允许目录分隔符、路径穿越或 Windows 无效文件名。同一文件只由一个应用进程驱动。文件 Host 使用原文检查和完整临时文件替换；其他编辑器不共享锁，不能承诺跨进程原子 CAS。MemoryScreen 在当前实例内提供原子条件写入。

## 协议与局部更新

Heading/Text 为普通 Markdown。Input、Check、Select、Action、Output 使用 HTML 注释：`<!-- textui:id=name type=input -->`。ID 可选；无 ID 时按类型、标签和分组唯一识别，歧义与重复 ID 明确报错。

React Input 保持单行，支持反斜杠和右方括号转义；纯文本示例通过显式 protocol 选项保留原有换行转义和空单选行为。事件统一为 change / select / trigger / textChange，按文档顺序派发；同批字段先恢复，再执行 Submit。处理器同步完成。Action 成功后复位；失败保留文本并回滚持久 Store。临时 useState 和外部副作用不参与回滚。

局部修改保留普通文本、非 TextUI 注释、CRLF 和用户移动后的控件位置。现有文档新增顶层控件追加到末尾；列表和引用中的交互子项支持安全的结构更新；静态内容更新须能唯一定位原文，冲突时拒绝覆盖。确认写入使用协议 epoch，令同样的下一次操作与编辑器重放的旧请求可区分；最近 128 个已确认请求只提供当前进程内的去重。

## 验证

```sh
pnpm check
pnpm test
pnpm test:workers
# 连同 Core 依赖单独构建某包：
pnpm --filter @mineral/textui-react... build
# 分包测试：
pnpm -r --filter @mineral/* test
```

Workers 验证通过 Wrangler 启动真实 workerd，注入内存 Host 运行 User 表单、Markdown Showcase 和 Custom Block，并通过 Durable Object SQLite Host 验证单 Screen 任务应用、应用层 React Router 和强制休眠恢复。配置明确使用 `no_nodejs_compat` 与 `no_nodejs_compat_v2`，并实测 Node 文件模块不可用。尚未部署云端服务。

[重构与验收说明](docs/screen-monorepo.md) · [Workers 兼容性测试](tests/worker-compat/README.md)


## 基础组件与自定义控件

提供 Divider、Link、Image、Code、CodeBlock、Quote、Section、List、OrderedList、ListItem、Table，使用标准 Markdown。Block 支持应用自定义文本格式、外部编辑事件和可选类型注册；应用可组合自己的 React 控件，无须修改 Core。

```sh
pnpm markdown-showcase
pnpm interactive-form
pnpm custom-block
```

[组件 API、自定义 Block 与身份规则](docs/phase-3-components.md) · [示例入口](examples/phase-3/run.tsx)

## 多 Screen 任务应用

```sh
pnpm task-app             # 三个 Markdown 文件，编辑后自动更新首页
pnpm worker-app           # Durable Object SQLite + WebSocket 订阅
pnpm test:packed-worker   # 独立 Worker 安装 npm tarball 后运行
```

应用层管理 Screen 生命周期、固定地址导航和跨屏派生状态，无需扩展 Core API。Worker 按请求创建并释放 Runtime，从文本恢复持久状态；原 WebSocket 在对象驱逐后继续订阅。

[Phase 4 架构与验收](docs/phase-4-applications.md) · [Worker 示例](examples/worker-app/README.md)

## Phase 6：表单与 API 预览

新增 Textarea、NumberInput、disabled/readOnly/required、自定义校验和 Strong/Emphasis/Strike。使用 `pnpm advanced-form` 或 `pnpm inline-markdown-showcase`；开发说明见 [Phase 6](docs/phase-6-form-controls.md)，完整属性和迁移说明见 [组件 API](packages/textui-react/API.md)。预览产物通过 `pnpm pack:preview` 准备，不自动发布。


开发自己的 React App，启动一次后保存源码即可热重载：

```sh
pnpm devtools --app examples/devtools/app.tsx --preview examples/devtools/preview.ts
```

将入口替换为自己的 `.tsx`；无需自定义 Block 预览时可省略 `--preview`。App 及其本地依赖自动更新，编译错误可修正后恢复。VS Code 的 **TextUI DevTools Extension** 调试配置自动启动监听构建。详细步骤见 [DevTools](devtools/README.md)。
