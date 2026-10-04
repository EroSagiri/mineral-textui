# Phase 4：单 Screen 应用与应用层路由

一个应用只有一个固定 Screen 和一个 React Root。任务应用使用 React Router 的 `MemoryRouter`、`Routes`、`Route`、`useNavigate` 切换页面；导航属于应用，框架与编辑器不认识路径或页面。

## 交互链路

```text
编辑 - [ ] 任务列表 → - [x] 任务列表并保存
→ 普通 Action trigger
→ 应用 onTrigger 调用 useNavigate('/tasks')
→ React Router 更新同一 Screen 的内容
→ Action 自动复位
```

所有操作均可在普通文本编辑器中完成。DevTools 工具按钮和原文 Action 标记点击只修改 `[ ]` 三个字符，再走普通自动保存。编辑器不解析 Markdown 链接为导航，也不调用路由。测试应用下拉选择不同示例，与应用内部路由分开。

## 最小框架适配

- `render(app, {host, screen})` 的 screen 固定；同一 Root 拒绝多个或嵌套 Screen。
- `app` 可为 `(snapshot: ScreenSnapshot|null) => ReactNode`，在订阅建立并读取当前文本后调用一次。应用自行恢复初始路由，框架没有路径、导航、load/release API。
- Section 作为普通可替换结构区域，支持页面控件整体变化。不能安全合并的外部修改保留原文并报错；Section 外普通备注保留。
- Block 支持现有 `readOnly`、`disabled` 约束。应用将路径和离开页面后的字段保存到自己的 `task-state` Block，通过 `useTextState` 绑定。该状态格式和含义属于任务应用。

React Router 只作为示例应用依赖，不进入 Core、React Runtime 或 Node Host 的依赖。MemoryRouter 不需要 DOM；示例采用 `useTransitions={false}`，使导航与同步文本事件事务一起提交。参考 [React Router MemoryRouter](https://reactrouter.com/api/declarative-routers/MemoryRouter)。ScreenPort 仍只提供文本、revision 条件提交和异步失效通知。

## 运行

```sh
pnpm install --frozen-lockfile
pnpm --filter textui-devtools-fixtures dev --no-open
```

此命令启动仓库专用回归工作台，访问终端打印的本地地址进入任务应用编辑器。通用 Devtools 接入自己的应用使用 `textui.dev.ts`，不内置任务应用。或者 `pnpm task-app` 后使用任意编辑器打开 `screens/task-app/app.md`。首页、任务列表、设置均写入这一个文件。更改当前页面字段并保存；修改导航 Action 后保存切换。重启恢复字段和当前路径，不重放历史事件。Ctrl+C 保存退出。

旧版 home/tasks/settings 演示文件不再使用，不自动覆盖或导入；新应用使用 app.md。

## Worker

`pnpm worker-app` 启动本地 SQLite Durable Object Host，默认端口 8787。同一个 application ID 只暴露一个固定 Screen `app`。

| 操作 | 地址 |
| --- | --- |
| 读取 | `GET /apps/demo/screen` |
| 条件提交 | `PUT /apps/demo/screen`，JSON `{text, expectedRevision}` |
| 订阅 | WebSocket `/apps/demo/screen/subscribe` |

GET/PUT 返回 `{screen:{id,text,revision},events,instance}`。旧 revision 返回 409；损坏协议或篡改只读状态返回 400。失效通知后重新 GET；WebSocket 发送 `snapshot` 读取最新完整文本。旧 `/screens/home` 等接口返回 404。

每次请求串行创建一个 Root，从 app 文本恢复应用状态和路由，处理编辑后释放 Root。SQLite 事务执行 compare-and-set；Hibernation WebSocket 通过 attachment 恢复订阅，重连需重新读取。参考 [Cloudflare Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)。示例没有身份验证或会话层。

## 验证

```sh
pnpm check
pnpm test
pnpm test:workers
pnpm test:packed-worker
pnpm devtools:check
pnpm devtools:test
pnpm devtools:test:browser
```

集成测试验证同一 Screen 跳转、字段和 Action 同批保存、离开页面后状态保留、重启恢复路径、无事件重放和外部备注。Worker 测试检查单条 SQL Screen 记录、CAS、不同应用隔离，以及强制对象驱逐后原 WebSocket 和路由恢复。浏览器验证直接编辑 Action、点击原文标记及工具按钮只修改文本。

独立消费者安装 Core/React tarball 和应用的 React Router，运行真实 workerd；不使用 workspace 链接。测试只证明本地 Node、workerd/SQLite 和对象驱逐行为，没有部署云端。
