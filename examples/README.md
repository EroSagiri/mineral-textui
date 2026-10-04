# 运行示例

在仓库根目录运行，使用 Node.js 24+ 和 pnpm 9.15.1。首次执行：

```sh
pnpm install --frozen-lockfile
```

以下命令会自动构建包，再通过公开包入口运行示例。

开发自己的应用可以运行 `pnpm devtools --app ./src/app.tsx`；自定义 Port / 多 Screen 接入示例运行 `pnpm devtools:examples`。通用工作台不内置仓库测试应用。见 [DevTools](../devtools/README.md)。

| 命令 | 内容 | 默认文件 / 退出方式 |
| --- | --- | --- |
| `pnpm start` 或 `pnpm user-form` | React User 表单 + Node 文件 Host | `screens/user.md`，Ctrl+C |
| `pnpm memory` | 同一 React 表单 + 内存 Host，自动演示双向同步与冲突拒绝 | 无文件，演示完成自动退出 |
| `pnpm counter` | 仅使用 Core 的计数器 + Node 文件 Host | `screens/counter.md`，Ctrl+C |
| `pnpm form` | 仅使用 Core 的表单 + Node 文件 Host | `screens/form.md`，Ctrl+C |
| `pnpm text-app` | 同时运行两个 Core 应用 | 上述 counter/form 文件，Ctrl+C |
| `pnpm animation-demo` | React 时间驱动进度条，可暂停恢复重置 | `screens/animation-demo/build.md`，Ctrl+C |
| `pnpm worker-animation` | SQLite DO + 按需 WebSocket 临时帧 | 本地端口 8788，Ctrl+C |
| `pnpm animation-client watch` | 订阅 Worker 临时画面，断线重连 | 需先启动 worker-animation，Ctrl+C |
| `pnpm measure:animation` | 低频文件写入与临时帧对比 | 自建临时目录，测量后自动清理退出 |

`screens/` 是生成的工作目录，已被 Git 忽略。终端打印实际文件的绝对路径；保持终端运行，使用任意文本编辑器打开该文件。不要把两个应用指向同一份文件。

Phase 5 具体操作见 [Node 动画](animation-demo/README.md) 与 [Worker 帧实验](worker-animation/README.md)，性能和是否提取帧模块的决策见 [阶段报告](../docs/phase-5-animation.md)。

## React User 表单

```sh
pnpm user-form
# 自定义文件（带空格的路径需要引号）：
pnpm user-form "./screens/my user.md"
pnpm user-form --help
```

1. 打开终端显示的 `screens/user.md`。把 `Name: [June]` 改成 `Name: [Alex]`，保存。
2. 把 Enable sound 前的 `[x]` 改成 `[ ]`，保存。
3. 把 Light 前的 `( )` 改成 `(*)`，保存；引擎会取消 Dark 的选择。也可以同次把 Dark 改成 `( )`。
4. 勾选主表单 Submit：将它前面的 `[ ]` 改成 `[x]`，保存。Main count 增加，Result 显示刚保存的字段，Submit 自动取消勾选。
5. 勾选预览表单 Submit 并保存，只有 Preview count 增加。两个 Submit 也可同次勾选保存，各执行一次。

可以把字段修改和 Submit 放在同一次保存中。保留控件后的 `textui` 注释；Count 和 Result 是应用输出，不要手动修改。只改字段不会提交，查看 Result 需要勾选 Submit。

再次启动同一路径会恢复持久字段和计数。需要重置时，先 Ctrl+C 退出，再删除生成文件并重新启动。

- [app.tsx](user-form/app.tsx)：组件树、`useTextState` 和同步 Submit 处理器。
- [run.tsx](user-form/run.tsx)：创建 Node Host、注入 `render`、打印路径、退出时关闭 Root 和 Host。

## 内存 Screen

```sh
pnpm memory
```

[memory/run.tsx](memory/run.tsx) 复用同一 UserForm，注入 `MemoryScreen`，依次打印：初始 Markdown、模拟编辑器保存后的表单、应用更新写回的 Name、过期版本被拒绝的结果。不需要打开编辑器，也不创建任何 Markdown 文件。

代码展示完整的读取快照 → 使用 `expectedRevision` 写入 → `root.idle()` 等待处理，以及应用更新后 `root.flush()` 写回流程。它是 Host 注入示例；实际 Workers 兼容性验证另运行 `pnpm test:workers`。

## Core 纯文本应用

```sh
pnpm counter
pnpm form
# 指定文件：
pnpm counter ./screens/custom-counter.md
pnpm form ./screens/custom-form.md
# 同时运行两个应用 / 查看 CLI 帮助：
pnpm text-app
pnpm text-app --help
```

计数器：勾选 Increment 并保存，Count 加一；勾选 Reset 并保存，Count 归零。操作完成后自动取消勾选。表单的编辑方式与上述 React 表单相同；纯文本版本额外支持转义换行和空主题。

- [counter/app.ts](counter/app.ts)、[text-form/app.ts](text-form/app.ts)：`Application` 的初始文本、校验和事件批处理，不依赖 React 或文件系统。
- [cli/launch.ts](cli/launch.ts)：组合 `startApplication` 和 Node Host。
- [cli/registry.ts](cli/registry.ts)：Core 应用注册列表。

Markdown 由当前代码在首次运行时生成；examples 不再保留旧的静态屏幕副本。默认 `pnpm start` 现在运行 React 表单，需要原来的两个 Core 应用时使用 `pnpm text-app`。

## Phase 3 组件示例

| 命令 | 默认文件 | 内容 |
| --- | --- | --- |
| `pnpm markdown-showcase` | `screens/markdown-showcase.md` | 全部标准 Markdown 组件、代码围栏、嵌套列表和表格 |
| `pnpm interactive-form` | `screens/interactive-form.md` | 列表内表单控件、主题选择、Submit 和结果 |
| `pnpm custom-block` | `screens/custom-block.md` | 应用格式、组合 SettingsBlock、私有类型注册、文本和语义事件 |

均保持监听，Ctrl+C 保存并退出。自定义路径：`pnpm phase3 custom-block ./screens/my-settings.md`。

Custom Block：修改代码块中的 `message=Hello` 或 `enabled=true`（布尔字段只接受 true/false）并保存；表格显示新设置，Enabled changes 统计外部编辑引起的布尔变更。勾选 Reset settings 由 React 写回默认文本，不计为外部事件。无效格式会报告错误并保留文件，修正后保存即可继续。再次启动恢复原始文本和计数。

源代码：[Markdown Showcase](phase-3/markdown-showcase.tsx)、[Interactive Form](phase-3/interactive-form.tsx)、[Custom Block](phase-3/custom-block.tsx)、[运行入口](phase-3/run.tsx)。扩展 API 见 [开发指南](../docs/phase-3-components.md)。

## Phase 4 单 Screen 任务应用

`pnpm task-app` 创建唯一的 `screens/task-app/app.md`。将导航 Action 的 `[ ]` 改为 `[x]` 并保存，应用通过 React Router 切换首页、任务列表和设置。字段、剩余数量及当前路径在重启后恢复。旧任务应用的浏览器回归位于 `tests/development-workbench`，与通用 Devtools 分开。Ctrl+C 保存并退出。

`pnpm worker-app` 在本地启动 SQLite Durable Object Host；HTTP 读取、条件提交和 Hibernation WebSocket 订阅均可使用。运行 `pnpm test:workers` 验证对象驱逐恢复，`pnpm test:packed-worker` 验证独立 npm 包消费者。

[共享任务应用](task-app/app.tsx) · [Worker 示例](worker-app/README.md) · [架构边界与完整验收](../docs/phase-4-applications.md)

## Phase 6 示例

`pnpm advanced-form` 创建 `screens/advanced-form.md`；`pnpm inline-markdown-showcase` 创建 `screens/inline-markdown-showcase.md`。可追加自定义 `.md` 路径；使用普通编辑器保存，Ctrl+C 退出。表单演示长文本、数值约束、禁用/只读和提交校验；格式示例可修改 Status 观察转义与重渲染。重启继续使用同一文件恢复状态，字段错误修复前保留编辑原文。详见 [Phase 6](../docs/phase-6-form-controls.md)。
