# Mineral Devtools

通用 TextUI 开发工作台，包名 `@mineral/textui-devtools`。开发者决定应用在哪里运行、怎样存储以及怎样路由；Devtools 连接应用提供的 ScreenPort，提供实时编辑、交互 Preview、多 Screen 切换、热更新和调试信息。Core、React 和 Host 的公共协议保持不变。

## 启动自己的应用

仓库中：

```sh
pnpm devtools --app ./src/app.tsx --preview ./preview.ts
```

App 默认导出普通 React 组件；Preview 可省略。访问终端打印的本地地址。此简易入口使用内存 ScreenPort，Screen ID 为 `main`。保存组件或其本地依赖后自动更新，编译错误显示在工作台，修正后恢复。500ms 自动保存 Markdown，也可点击立即保存。应用代码只在本地开发服务运行。

独立工程安装包后使用相同 CLI：

```sh
pnpm exec textui dev --app ./src/app.tsx
```

目前未发布到 npm；本地构建后可用 `pnpm --dir devtools pack --pack-destination ../.artifacts/packages` 生成安装包。开发项目也需安装 React，以及对应的 Core / React 本地包或已发布版本。`pnpm devtools:test:packed` 会在系统临时目录中安装三个 tarball、启动独立应用并验证文本交互，确认没有工作区链接。

## 自定义 ScreenPort

在开发项目根目录创建 `textui.dev.ts`，CLI 自动发现，也可显式指定 `--config`。所有路径相对于开发项目根目录；编程调用 `startDevtools` 可指定 `projectRoot`。

```ts
import {defineDevtools} from '@mineral/textui-devtools';
import {render} from '@mineral/textui-react';
import {createElement} from 'react';
import {createMyPort} from './src/host';

export default defineDevtools({
  preview: './preview.ts',
  async createSession(context) {
    const port = context.observePort(await createMyPort());
    const entry = './src/app.tsx';
    const module = await context.loadModule(entry);
    const app = await render(createElement(module.default), {host: port, screen: 'home'});
    return {
      label: 'My application', mode: 'local', port, app, entry,
      discovery: {listScreens: () => getMyScreens()},
      inspect: () => ({state: Object.fromEntries(app.store.snapshot())}),
      close: () => app.unmount(),
    };
  },
});
```

`getMyScreens()` 返回 `{id, label?}[]`。应用已经在正确环境中启动时，工厂也可直接返回现有实例，不需要再启动 App。`observePort` 是可选观察包装器，不改存储实现；对运行时使用的 Port 进行包装后，工作台能发现应用访问过的 Screen。Bridge 自身也记录编辑器访问过的 ID。

没有 discovery 时可以手动输入 Screen ID。ID 支持 Unicode、空格和斜杠，工具不会推断它们的路由含义。多 Screen 会话可以提供自己的 `app.update(node)`，或 `reload(context)`；只提供 Port 时读写和 Preview 可用，但工具不会猜测怎样热更新应用。`entry` 必须通过 `context.loadModule` 加载，才能跟踪其依赖。

配置工厂及其静态导入仅在服务端加载，拒绝浏览器读取。配置重载会先释放旧会话；若新工厂启动失败，连接暂停并显示诊断，修正配置后重新创建。Preview 是独立浏览器入口；不要让 Preview 导入 Host / 会话配置。

仓库自定义 Host 示例：

```sh
pnpm devtools:examples
```

示例位于 `examples/devtools`，提供两个可发现的 Screen 和一个手动输入 ID 的 Screen。它使用应用自己的三方法适配器，通用工具不导入示例代码。

## 三种会话模式

| 模式 | 运行环境 | 责任 |
| --- | --- | --- |
| Sandbox Preview | 简易 `--app` 的内存 Port，或应用提供的隔离工厂 | 工厂负责 Mock 数据库 / 外部 API 副作用 |
| Local Runtime | 工厂提供的实际 Port | 编辑真实开发数据，条件写入和订阅都走原 Port |
| Remote Runtime | 已运行的开发 Bridge | 本地工作台代理 HTTP / WebSocket；不加载远端 Host |

`--app` 内存模式隔离 Screen 存储，但不能隔离 App 直接发出的网络请求。`cloneScreens(source, target, ids)` 可把指定快照克隆到隔离 Port；它不克隆数据库，不代表完整副作用隔离。配置 `mode: 'sandbox'` 或 `--mode sandbox` 时，工厂必须明确返回 `mode: 'sandbox'` 并自行提供隔离环境。

## Remote Bridge

```ts
export default defineDevtools({
  remote: {url: 'http://127.0.0.1:8787/devtools', token: 'development-secret'},
  preview: './preview.ts',
});
```

也可用 `textui dev --connect http://127.0.0.1:8787/devtools`。Token 留在本地服务，浏览器不接收它。

远端应用使用 `createDevtoolsBridge(session, {enabled, instanceId, token?})`。默认应在正式部署中传入 `enabled: false`；`instanceId` 应标识实际 Host 会话，重建 Host 时更换。该模块只使用标准 Request / Response 和 ScreenPort，不依赖 Node。

应用将 `/devtools` 前缀去掉后交给 `bridge.handleRequest(request)`：

| 路径 | 用途 |
| --- | --- |
| `GET /config` | 会话信息、Screen 发现 |
| `GET /inspect` | 观察日志和应用提供的 state / tree / router |
| `GET /screens/:encodedId` | Screen 快照 |
| `PUT /screens/:encodedId` | `{text, expectedRevision}` 条件修改；冲突返回 409 |
| `WS /screens/:encodedId/subscribe` | Host 自己处理升级；订阅完成后发送 ready、变更发送 change、临时显示发送 frame |

WebSocket 升级前检查 `bridge.authorized(request)` 和本地开发 Origin，再通过 `bridge.subscribeScreen(id, send)` 发送协议消息。连接关闭时调用返回的取消函数；若升级期间连接已经关闭，也应立即取消后续完成的订阅。工具仅连接这份通用协议，不理解某个示例应用的私有 URL。

远端 App 热更新由它自己的开发服务器负责，Devtools 通过订阅更新画面。此轮验证了通用远程协议，未添加真实 workerd 的 Bridge 适配器，也未替换应用现有的 Workers 开发流程。

## 交互、草稿和 Inspector

Split / Preview / Source 控制工作台布局。Preview 展示当前未保存缓冲区；Runtime 展示 Host 确认的只读快照。Preview 的所有控件只生成 CodeMirror 文本补丁，保存后由原 Runtime 处理业务事件。普通 Markdown 正常显示；未知自定义 Block 保留代码块。`@mineral/textui-devtools/preview` 导出 `definePreview` 和 `PreviewRegistry`，renderer 接收 Block 和 `{writable, edit(value)}`，返回 DOM 节点。

草稿按 Bridge 实例与 Screen ID 保存。切换 Screen 不强制保存草稿；切回时与最新快照合并。冲突保留输入并暂停自动保存。Host 替换后旧草稿只供查看和手动复制，不自动提交到新 Host。草稿当前只保存在页面内存中，关闭页面前请保存；有未保存草稿时提示离开。

临时帧通过可选 `subscribeFrames` 连接，只投影 Output，检查 revision、sequence、时间和目标，不写入 Markdown。编辑中的草稿不叠加临时帧。

Runtime Inspector 显示 Bridge 读写 / 变更日志以及应用提供的 state、tree、router。Router 由应用实现；没有提供的字段不伪造。当前没有完整 React Fiber / Hooks Inspector。App 更新复用 Runtime，保留 `useTextState`；普通 `useState` 不保证保留，尚未接入 React Fast Refresh。

## VS Code 扩展开发

```sh
pnpm vscode:build
pnpm vscode:watch
```

仓库 F5 配置 **TextUI DevTools Extension** 自动启动监听构建。成功构建替换扩展 Runtime 并重新打开原文档 Preview。改启动器或扩展清单需要重启 F5。扩展绑定当前 Markdown 文档，所有操作使用带 URI / 文档版本的 WorkspaceEdit；业务链路需应用自己的文件 Host，保存遵循 VS Code 设置。

扩展当前提供文档 Preview，不连接浏览器 Bridge 的 Inspector。未发布 Marketplace，也未完成真实 Extension Host 窗口的自动重载验收。构建与替换机制有自动化验证。自定义 Preview 构建入口仍可用 `TEXTUI_DEVTOOLS_PREVIEW` 指定。

## 工具与仓库测试的边界

`devtools/` 包含通用工作台与独立包接口。`examples/devtools/` 是应用接入示例。`tests/development-workbench/` 单独保留原表单、任务、动画、Worker 专用回归工作台，不进入工具发布包；其测试命令为 `pnpm devtools:test:fixtures`。

验证命令：`pnpm devtools:check`、`pnpm devtools:test`、`pnpm devtools:test:browser`、`pnpm devtools:test:project`、`pnpm devtools:test:packed`。浏览器测试使用系统 Chrome / Edge，或通过 `TEXTUI_DEVTOOLS_BROWSER_PATH` 指定浏览器。
