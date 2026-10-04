# Durable Object 任务应用

根目录运行 `pnpm worker-app`，读取 `http://localhost:8787/apps/demo/screen`。一个应用一个固定 Screen `app`，首页、任务列表和设置通过应用自己的 React Router 切换。

将 `- [ ] 任务列表` 改为 `- [x] 任务列表`，使用 `PUT /apps/demo/screen` 提交 `{text, expectedRevision}`。应用处理 Action 后更新同一文本并复位标记。WebSocket `/apps/demo/screen/subscribe` 提供失效通知；收到通知后重新读取，发送 `snapshot` 可读取最新完整文本。

每个请求创建并释放一个 Root；SQLite 保存文本、字段和路径，Hibernation API 恢复 WebSocket。Ctrl+C 停止，本地数据保留在 `.wrangler/state`。旧三屏接口已移除。

`pnpm test:workers` 验证单 Screen、并发冲突、对象驱逐和订阅恢复；`pnpm test:packed-worker` 验证独立 tarball 消费者。详见 [应用架构](../../docs/phase-4-applications.md)。
