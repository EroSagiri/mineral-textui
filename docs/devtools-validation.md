# DevTools 验证与性能记录

## 通用会话与独立工程验证（2026-10-04）

Devtools 已拆为可打包的 `@mineral/textui-devtools`；固定表单、任务、动画与 Worker 代理移至 `tests/development-workbench`。以下记录通用工具验收，后面的旧记录保留作为此前专用测试工作台的历史结果。

| 检查 | 结果 |
| --- | --- |
| 工作区类型 / 包边界 | Core、React、Host 原协议和依赖边界保持；工具与专用工作台类型检查通过 |
| 工作区单元与集成 | 123 项通过，包含移出的旧动画接收回归 |
| 通用 Devtools 单元 | 26 项通过，覆盖 Bridge、CAS、关闭 / 鉴权、快照隔离、临时帧、文本补丁与插件适配 |
| 通用 Chrome 会话 | 3 项通过：自定义三方法 Port、多 Screen 草稿 / HMR、手动 ID、Inspector、Host 替换隔离及通用 Remote Bridge |
| 独立 tarball 工程 | 系统临时目录安装 Core / React / Devtools，无工作区链接；真实 Chrome 验证 Preview、Action、订阅、持久状态和 HMR |
| App / 依赖 / Preview 热更新 | 编译错误保留旧组件，修正后恢复；未保存输入和页面实例保留 |
| VS Code | 构建、监听构建、成功标记及编译错误恢复通过；真实 Extension Host 窗口仍未验收 |

远程验证使用独立 HTTP / WebSocket Bridge 服务，未执行真实 workerd Bridge 适配、云部署或生产写入。完整 React Fiber / Hooks Inspector 和 Fast Refresh 尚未实现；Inspector 仅显示应用提供的数据，普通 `useState` 不保证保留。

仓库专用浏览器回归 21 项全部通过。旧浏览器回归共享当前编辑 / Preview 模块，测试应用及私有 Worker API 适配留在专用工程。测试现在隔离每次运行的文件数据；IME 用显式 composition 生命周期和组合事务模拟，不能视为真实中文输入法验收。


## 开发工具升级验证（2026-10-04）

新增 Source / Live Preview / Runtime 投影、自定义 React App 与开发工具专属 Preview Registry，以及共享投影模块的 VS Code 扩展。以下是本次升级实际执行的验证；后文保留此前 DevTools 的基线记录。

| 检查 | 本次结果 |
| --- | --- |
| `pnpm check` / `pnpm test` | 类型、平台边界通过；原有 79 项测试通过 |
| DevTools 类型检查 / 单元测试 | 22 项通过，包含局部协议补丁、输入转义、单选组、CRLF/围栏扩展与 VS Code 版本拒绝 |
| Chrome 完整集成测试 | 21 项全部通过，约 1.4 分钟；包含 Node 与本地 Worker HTTP/WebSocket/动画链路 |
| 自定义 App 浏览器验证 | React App、server-chart 注册、Action → 文本保存 → Runtime → Preview 完整往返通过；无页面异常 |
| VS Code 扩展构建 | Extension CJS 与 Webview bundle 通过；消息适配器测试证明错误 URI/过期版本不写入文档 |

新增浏览器测试验证未保存 Preview 与已确认 Runtime 的差异、Preview Action 在保存前仅修改文本、普通 Markdown 结构及 HTML 禁用、Textarea 多行输入和焦点保留。临时帧现在只覆盖 Preview 的 Output，Source 与 Runtime 保持持久文本。

VS Code 消息测试使用文档适配器模拟，未执行真实 Extension Host 的 F5、撤销重做或 Webview UI 验收。实际中文输入法、移动端和超大文档性能仍未验证。自定义 App 入口与导入的本地模块现在自动重载；Preview 模块可由 Vite 更新。扩展当前只预览文档缓冲区，不提供浏览器的 Runtime、Frame 或 Inspector 面板。

运行与扩展开发步骤见 [DevTools README](../devtools/README.md)。

## 原 DevTools 基线记录

验证日期：2026-10-04。Windows、Node.js 24.12.0、pnpm 9.15.1、系统 Chrome，CodeMirror 6。工具私有；本次增加单 Screen 约束、当前快照初始化和 Section 结构适配。ScreenPort 不变，未部署云端。

## 结果

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 原有类型检查、Worker 类型检查、包边界与无 DOM/Node 依赖检查通过 |
| `pnpm test` | 79 项测试通过，包括单 Screen 约束、快照初始化、应用路由及页面内外备注保护 |
| `pnpm devtools:check` | DevTools、浏览器代码、本地服务和测试类型检查通过 |
| `pnpm devtools:test` | 16 项自动化测试通过，包括通用 Action 只修改文本标记 |
| `pnpm devtools:test:browser` | 17 项真实 Chrome 测试通过，约 1.3 分钟；覆盖默认启动及文本 Action 导航 |
| `pnpm test:workers` | 无 Node 兼容 workerd 探针、任务应用 3 项与动画 5 项测试通过 |
| `pnpm test:packed-worker` | 独立 tarball 消费者单 Screen 路由和派生状态验证通过 |

导航验证：编辑 `[ ]` 为 `[x]`，应用收到 Action 后通过 React Router 切换同一 Screen 的 Section。工具按钮和原文标记点击只编辑这三个字符；将防抖延长后验证保存前页面未切换。字段与导航同批保存，路径在重载后恢复。冲突时禁用增强按钮并保留本地文本。删除原链接导航实现，编辑器不再解析 URL 或选择业务页面。

自动化覆盖多个非相邻差异、UTF-16 偏移、三方合并、重叠/边界插入冲突、500ms 防抖、自身通知无保存回环、保存期间继续输入、失败保留输入与重试、CAS 失效后重新读取合并、订阅先于初始化读取、不透明 revision、组合输入暂缓补丁，以及 40 帧的顺序、动画身份、版本、过期时间和目标检查。

真实浏览器覆盖默认进入并聚焦编辑器、键盘输入落盘、外部文件更新合并未保存输入、冲突暂停/禁止切屏/手动合并、多补丁光标映射、跨行选区/滚动/焦点、所选内容被删除后的合理映射、本地撤销与重做、IME 组合事件生命周期、屏幕间撤销隔离、临时帧/每秒持久更新、动画期间 Input 编辑及第二个标签页中的 Textarea 编辑、Worker HTTP 保存、WebSocket 主动断开后读取断线期间的新版本、Worker 动画编辑与 reset 清除投影。

Worker 测试使用现有 Wrangler/workerd 模拟器、SQLite Durable Objects 和应用代码。独立端口 8797/8798、任务 application ID `devtools-single-screen-test`、独立 `.artifacts/` 持久目录；兼容日期显式采用本地测试基线 `2026-10-03`。这里只证明本地 Worker 集成，没有执行云端部署或生产写入。流程依据 [Cloudflare 本地开发文档](https://developers.cloudflare.com/workers/local-development/) 和项目安装版本的命令帮助。

## 10 秒动画记录

测试复用 Phase 5 的实际时间驱动应用。临时帧使用现有帧协议和 FrameReceiver；没有实现新的业务动画。Node 服务仅在 build 有浏览器订阅时提供每 250ms 的投影帧。

| 模式 | 本次观察 |
| --- | --- |
| 临时帧 build | 收到 42 帧，丢弃 0 帧；动画播放期间取 10 次文件样本（间隔 250ms），全部相同；同一采样窗口 Host 通知计数增量为 0 |
| 临时帧 build | 开始后的 Host 写入计数增量为 2：用户修改 Note 和动画完成；编辑器保存次数为 3，包含 Reset、Start、Note；临时帧本身不保存 |
| 持久 low-build | 首次观测到进度后的 Host 写入计数增量为 9（包含用户 Note 和完成更新）；浏览器接收 0 个临时帧；本次总计 86 个局部补丁 |

实际帧数受应用完成调度及订阅时机影响，不承诺精确 40 个网络帧。另有确定性的 40 帧接收测试。两种模式的计数窗口不同，不能直接把上表作为整段动画写入次数的严格倍数比较；原始结果写在 `.artifacts/devtools-frame-metrics.json` 和 `.artifacts/devtools-persistent-metrics.json`。没有设定未测量的延迟指标。

局部差异使用 [jsdiff](https://github.com/kpdecker/jsdiff)；按每个变化段的字符串长度转换为 CodeMirror 所需的 UTF-16 偏移。远程事务保留 EditorState，通过 ChangeSet 映射选区和已有历史，采用滚动快照，不重建整个文档状态。只在主动切换 Screen 时重新建立编辑状态。

## 限制

- 中文测试模拟浏览器 composition 生命周期，尚未验证真实中文输入法和 Android/手机设备。
- Textarea 并发测试与动画处于两个 Screen / 浏览器标签页；现有 Phase 5 动画 Screen 自带的是 Note Input，没有添加新的业务控件。
- 目前临时帧实验只支持 Phase 5 的 progress 字符串输出；沿用现有接收器的保守动画身份检查，不解释自定义 Block 内部语义。
- 字符 Diff 和控件定位在浏览器主线程执行。文档上限 1MiB，超大文档性能未验收；事件日志保留最近 120 条。
- 每次切屏重置编辑器历史，不缓存跨屏未保存状态；有未保存失败/冲突/组合输入时切屏被阻止。
- 浏览器未保存输入仍保存在内存中。离开提醒不能保证强制关闭或服务突然停止时保存；退出前等待 Saved。没有 CRDT 或离线持久草稿。
- Node 文件 Host 的外部编辑器不共享锁，沿用现有跨进程 CAS 限制。Worker 代理不支持登录/Access；远程生产端、长时间网络故障和移动端仍未验证。


## App 与扩展热重载追加验证

2026-10-04：自定义 App 使用 Vite 依赖图定位更新并串行调用现有 Runtime.update。实际 Chrome 验证入口 `.tsx` 和导入模块保存后更新、页面实例与未保存字段保留、编译错误时保留上次 App、修正后恢复。23 项工具测试及类型检查、扩展构建通过；新增扩展 Runtime 替换测试覆盖旧实例释放、原文档 Preview 恢复和监听清理。真正的 Extension Host UI 仍未验收。


扩展监听构建烟雾验证通过：保存自定义 Preview 后 bundle 与重载标记更新；编译失败不发出成功标记；修正后继续构建。运行 `pnpm vscode:test:watch` 可复现。该检查不启动真实 VS Code 窗口。
