# @mineral/textui

纯 TypeScript 文本 UI 核心：ScreenPort、条件写入错误、MemoryScreen、ScreenSession、Markdown 控件解析/序列化/局部更新、事件模型与持久 Store。无 React、Node.js 或 Cloudflare 依赖。

```ts
import { MemoryScreen, parseTextUI } from '@mineral/textui';
const host = new MemoryScreen();
const snapshot = await host.setScreen('home', 'Name: [June] <!-- textui:type=input -->', { expectedRevision: null });
const document = parseTextUI(snapshot.text);
```

revision 是不透明版本。创建传 null，更新传当前版本，冲突抛出 ScreenConflictError。ScreenPort 只含读取、条件写入、异步订阅；另外四项可选接口仅定义类型，不在本阶段实现。

包提供编译后的 ESM 与类型声明。构建：`pnpm build`；测试：`pnpm test`；打包：`pnpm pack`。

Core 导出 ParsedBlock、BlockTypeRegistry、registerBlockType 和 fencedCode；parseTextUI 的 blocks 保存可编辑围栏及原文范围。semanticDiff 识别 textChange，并可通过独立 registry 派生 blockEvent。使用方式见 [Phase 3 开发指南](../../docs/phase-3-components.md)。

Phase 6 提供 Textarea、NumberInput、约束校验及行内格式；公开组件参考见 [React API 参考](../textui-react/API.md)。
