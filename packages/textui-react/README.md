# @mineral/textui-react

React 19.3.0 / react-reconciler 0.34.0 文本渲染器，通过注入的 ScreenPort 运行。HostConfig 仅维护内存节点，文件系统和云平台均不属于此包。

```tsx
import { render, Screen, Input } from '@mineral/textui-react';
import { MemoryScreen } from '@mineral/textui';
const host = new MemoryScreen();
const root = await render(<Screen><Input label="Name" value="June" /></Screen>, { host, screen: 'home' });
await root.unmount();
```

导出标准 Markdown 组件、基础交互组件、可扩展 Block 和 useTextState。持久字段绑定 stateKey 或同名显式 ID；Root 的 update / flush / idle / unmount 均异步。事件处理器同步完成，同一屏幕事务串行写入。

一个应用 Root 只有一个固定 Screen；多个或嵌套 Screen 会报错。导航由应用使用 React Router 等生态库实现，通过普通 Action 文本编辑触发。框架不包含路由依赖。`render(snapshot => <App initial={snapshot}/>, options)` 支持在订阅建立后用当前文本初始化应用；路径和离开页面后的字段由应用绑定 Block 持久化。示例见 [单 Screen 应用](../../docs/phase-4-applications.md)。

包提供编译后的 ESM 与类型声明。工作区首次构建包括依赖：`pnpm --filter @mineral/textui-react... build`。本包测试：`pnpm test`；打包：`pnpm pack`。


完整组件 API、动态列表身份和自定义 Block 类型注册见 [Phase 3 开发指南](../../docs/phase-3-components.md)。

Phase 6 提供 Textarea、NumberInput、约束校验及行内格式；公开组件参考见 [API.md](./API.md)。
