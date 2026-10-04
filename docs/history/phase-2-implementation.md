# Phase 2 实现及验收记录

日期：2026-10-04。开发前基线：`815a112`；实现分支：`codex/phase-2-react`。开发前原有 13 项测试与类型检查通过。`phase-2-react.md` 保存本阶段原始开发说明；旧 `milestone-2.md` 记录之前的非 React 原型。

## 架构与接口

- `src/react/host-config.ts`、`reconciler.ts`：React mutation Host Tree，实例创建、更新、插入、删除、文本更新、隐藏和卸载。
- `src/react/renderer.ts`：一个 Root 拥有独立 Store、注册表与监听器。提交后调度序列化和 Screen 写入；初始恢复和外部事务期间抑制中间写入。
- `src/react/components.ts`：Screen、Heading、Text、Input、Check、Select、Action、Output，使用 React createElement，可由 JSX 调用。
- `src/react/hooks.ts`、`src/core/store.ts`：`useSyncExternalStore` 与标量持久状态，`stateKey` 绑定文档控件，启动恢复早于第一次覆盖。
- `src/markdown/parser.ts`：unified / remark-parse / remark-gfm 判断代码范围，独立保留原文控件和值范围；不重序列化 AST。
- `src/markdown/serializer.ts`、`patch.ts`：规范注释、运行时身份、组件注册表、值局部修改、控件增删和静态块更新；三方值变化及范围歧义报错。
- `src/core/events.ts`：按文档顺序生成 change / select / trigger；单选每组切换派发一次事件。
- `src/screen.ts`：保留内容比较和 epoch 机制，补充独占创建、临时文件准备、提交前二次检查及完整内容替换；监听父目录并只接收目标文件，避免替换文件后丢失后续事件。

React 固定为 19.3.0，react-reconciler 固定为 0.34.0，安装时确认 peerDependencies 为 `react: ^19.3.0`。运行时 HostConfig 按安装包实现核对；Reconciler 的公开 Context 类型断言只用于适配类型声明暴露的 React 内部字段。

## 使用与事务规则

运行 `npm run user-form`，通过同一个 JSX 应用生成 User 表单。可以指定 Markdown 文件：`npm run user-form -- ./profile.md`。Ctrl+C 释放 React Root 与文件监听。

`await render(<App />, {file, onError})` 返回 `update(app)`、`flush()`、`unmount()`、Store 和 `getTree()`。所有文件 IO 发生在 React 提交之后，通过 Screen 执行。React 暂时状态可以使用 useState；持久字段使用 useTextState，且通过 `stateKey` 或相同的显式 ID 关联 Input/Check/Select/Output。未绑定状态报错，避免重启丢失状态。

启动恢复合法字段和输出，不调用用户事件，不重放已有勾选 Action。外部批次先完整解析与语义校验，再更新 Store、刷新事件回调并按原文顺序派发。单选新选项自动取消原选项；同时新选多个选项报错。事件处理器同步完成，成功的 Action 与业务输出同次回写，最近 128 个请求哈希抑制重复保存。失败时回滚持久 Store、保留文件并阻止后续自动写入，等待用户修复和再次保存。临时 useState 与任意外部副作用不参与 Store 回滚，处理器不能依靠该机制回滚网络副作用。

Output 外部编辑不更新 Store、不派发输入事件；报告诊断并恢复应用定义值。代码示例内的协议不会成为控件。显式 ID 稳定；无 ID 控件按类型、标签、分组唯一识别，标签变化视为身份改变并报错。

## 验收证据

`npm run check` 验证源码、示例和测试的 TypeScript 类型。`npm test` 包括原有 13 项真实文件/CLI 测试和新的 13 项 Vitest 测试，共 26 项：

- JSX 全组件输出、React Hooks 更新、effect 挂载/释放，无 DOM。
- 双 Submit 独立计数、Action 自动复位、重复请求去重、同次保存提交读取最新输入。
- Input 转义、Check 双向切换、Select 新旧值事件与互斥、无效单选批次整批拒绝。
- 启动持久恢复、数字校验、遗留 Action 不执行、未绑定字段明确报错。
- 普通 Markdown、非 TextUI 注释和 CRLF 保留；Heading/Text 和控件增删局部更新。
- 重复 ID、无 ID 同名歧义、损坏协议拒绝；修复后继续处理。
- 值并发变化拒绝、待处理磁盘编辑保留、失败处理器无部分回写。
- 实际文件原子替换后继续监听、Root 文件所有权释放、真实 Node 子进程执行 JSX User 表单。

## 当前边界

本阶段不实现导航、网络同步、动画或完整 Markdown 排版编辑。新增组件的初次文件完整呈现 JSX 顺序；现有文档新增控件追加到末尾，已有控件移动优先保留用户的文件位置。静态块更新采用唯一原文匹配，无法定位时报告冲突，不猜测位置。

每个文件只允许一个应用进程驱动，同进程 Root 所有权有显式保护。外部编辑器不共享锁，临时文件替换和二次原文检查仍不等于跨进程原子 CAS；Action 去重也不是崩溃恢复后的严格 exactly-once。自动化验证覆盖 Windows 上的 Node 文件监听与真实 CLI；未测试特定编辑器的点击、自动保存和预览刷新。

原子写入接入时曾发现 Windows 文件路径监听偶发漏掉紧随替换发生的外部保存；改为父目录监听后，CRLF/局部更新路径连续验证 8 次、外部原子替换路径连续验证 5 次通过。
