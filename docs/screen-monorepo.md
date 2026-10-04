# Screen 抽象与 Monorepo 重构

日期：2026-10-04。开发起点为已验证的 Phase 2 提交 `317729c`，分支为 `codex/screen-monorepo`。

## 包边界与迁移结果

三个 npm 包都有 ESM 和类型声明入口，使用 pnpm workspace；React 与 Node Host 分别依赖 Core，互不依赖。

- `packages/textui`：ScreenPort、ScreenConflictError、四项可选能力类型、内存参考 Host、串行 ScreenSession、唯一一套 Markdown Parser/Serializer/Patch、事件模型、持久 Store、纯文本 Application API。
- `packages/textui-react`：Reconciler、HostConfig、八个组件、Hooks 与异步 React Runtime。环境依赖全部通过 ScreenPort 注入。
- `packages/textui-host-node`：文件创建、读取、完整临时写入与替换、版本检查、父目录监听、通知和资源关闭。
- `examples`：React User 表单、内存 Host 演示、计数器/纯文本表单与 CLI 组合层；当前运行入口见 `examples/README.md`。
- `tests/integration`：真实文件和 CLI 验证；包内 tests 分别验证 Core、React 和 Node Host。
- `tests/worker-compat`：使用同一 User 表单的 Wrangler/workerd 兼容性项目，不提供生产 Cloudflare Host。

Core 使用 remark-parse 原有的底层 mdast/micromark 解析能力和 GFM 扩展，保留源范围。删除 unified/vfile 运行时层，避开其 Node 条件导入；构建时把 Markdown 解析器按平台无关条件打入 ESM，发布的 Core 没有外部运行时依赖，也不会因消费端 browser 条件改用 DOM 解码器。Core 的 TypeScript 编译不提供 Node 或 DOM 全局类型。

原根目录源码、旧 Screen 类、重复 Parser/Serializer/EventBus、旧单包导出、旧测试位置与 npm 锁文件均已清理。原说明归档到 `docs/history`，不再表示当前调用入口。没有为旧目录保留包装层。

## 接口决定

```ts
interface ScreenSnapshot { id: string; text: string; revision: string }
interface ScreenChange { before: ScreenSnapshot; after: ScreenSnapshot; origin?: string }
interface ScreenPort {
  getScreen(id: string): Promise<ScreenSnapshot | null>;
  setScreen(id: string, text: string, options: {
    expectedRevision: string | null;
    origin?: string;
  }): Promise<ScreenSnapshot>;
  onScreenChange(id: string, listener: (change: ScreenChange) => void): Promise<() => void>;
}
```

采用参考建议的严格版本：expectedRevision 必填，null 只允许创建；旧版本抛出 ScreenConflictError。revision 由 Host 管理，仅相等比较，不能当作排序值或事件游标。成功的相同文本写入可以不产生事件，但仍要检查版本。创建通知 before 使用空文本、空 revision 的合成快照；空 revision 不能用于更新。

ScreenDirectory、ScreenLifecycle、ScreenPatch、ScreenChangeFeed 只定义独立接口，本次不实现。Feed 的 cursor 与 revision 分离，历史保留及重连规则交给实现 Host。

Node Host 存储提交的原始文本，独立管理不透明 revision，不解析 Markdown。协议 epoch 属于纯核心确认写入，可在文件、内存或其他 Host 上使用，保留 Action 新请求/旧快照重放的区分。

## 异步事务与生命周期

先等待订阅完成，再读最新快照。初始化结束再次读取，弥合订阅/读取和初始化期间的变化。通知触发最新 Screen 读取；延迟或重复通知不会把旧快照重新应用，origin 不作为唯一过滤条件。

React 和纯文本应用共用 ScreenSession 的串行事务通道：读取最新版本、完整校验、恢复持久字段、按文档顺序派发事件、React 同步提交、生成局部文本、按源 revision 条件写入、确认基线。写入冲突会保留外部文本并重新读取；React 失败事务回滚持久 Store，等待新的合法修改。

React Root 的 update/flush/idle/unmount 均返回 Promise。Root 只移除自己的订阅；Host 生命周期由应用拥有，因此两个不同 Screen 可以共享同一个 Host。Node Host 移除最后一个订阅者时释放监听，close 等待关闭完成。MemoryScreen 可直接在无 DOM 环境使用。

## 功能保留

Heading/Text、Input/Check/Select/Action/Output 的 Phase 2 语义保留。无 ID 唯一身份、重复 ID 错误、原文范围、普通 Markdown/注释/CRLF、双 Submit、独立计数、重启恢复、只读 Output、Action 成功复位和旧请求去重均继续验证。

原计数器和非 React 表单的协议选项显式允许转义换行及空单选，保留这些已有行为；React 默认仍为单行 Input、选中后需选择替代主题。事件统一使用 change/select/trigger，纯文本应用已迁移到同一模型，业务行为不变。运行中的临时 useState 或外部网络副作用不参与 Store 回滚，处理器同步完成。

## 验收记录

- `pnpm check`：三个包构建、全项目类型、包边界/循环检查、完整平台无关依赖图、Wrangler 生成类型与 Worker 类型检查。
- `pnpm test`：原有 26 项有效测试迁移后继续覆盖，连同新契约/异步/内存 Host 测试共 38 项。
- `pnpm -r --filter @mineral/* test`：各包独立测试，Core 10 项、React 3 项、Node Host 3 项；跨包集成另有 22 项。
- `pnpm test:workers`：真实本地 Wrangler 4.147.0 / workerd 1.20261001.1，使用 MemoryScreen 完成同一 User 表单的输入、复选框、互斥单选、双 Submit、反向更新及旧版本冲突拒绝。
- 发布准备：三个包打包为独立 tarball，workspace 依赖替换为 npm 版本范围；在仓库外安装三个产物，验证公共入口、内存渲染和文件读写，未执行 npm 发布。

Workers 兼容配置使用 2026-10-03。客户端当天 2026-10-04 被本地运行时作为未来日期拒绝，因而采用当前可接受日期。新兼容日期默认开启 Node 模式，测试明确同时设置 no_nodejs_compat 与 no_nodejs_compat_v2，并实测 Node 文件模块不能导入。[Cloudflare 开关说明](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#nodejs-compatibility-flag)

## 保证范围

MemoryScreen 的条件写入在当前实例内原子执行。普通文件 Host 与不共享锁的编辑器只能提供有限冲突检测；原文再次检查与完整替换不是跨进程原子 CAS。每个文件仍应只由一个应用进程驱动。

订阅只覆盖当前 Host 实例，未实现跨进程事件历史、远程重连或可靠多端传输。Workers 验证在真实 workerd 本地运行时执行，没有部署云服务，也没有证明生产 Durable Object 存储或订阅行为。
