# @mineral/textui-host-node

Node.js 文件 ScreenPort：`createNodeHost(directory, { onError })`，将 ID 映射为目录中的 `<id>.md`。订阅异步启动 Chokidar 父目录监听，移除最后一位订阅者时释放监听；Host close 等待相关资源关闭。

```ts
import { createNodeHost } from '@mineral/textui-host-node';
const host = createNodeHost('./screens');
const first = await host.setScreen('home', '# Hello', { expectedRevision: null });
await host.setScreen('home', '# Updated', { expectedRevision: first.revision });
await host.close();
```

Host 不理解 Markdown 或 React，存储提交的原始文本，revision 由 Host 管理。外部编辑器不共享锁，因此文件原文比较与临时替换仅提供有限冲突检测，不能承诺跨进程原子 CAS。一个文件只由一个应用进程驱动。

包提供编译后的 ESM 与类型声明。工作区首次构建包括 Core：`pnpm --filter @mineral/textui-host-node... build`。测试：`pnpm test`；打包：`pnpm pack`。
