# Phase 6：Form Controls & API Stabilization

实现 Textarea、NumberInput、交互约束、统一校验与 Strong/Emphasis/Strike；维持三个包、现有事件和 ScreenPort。完整公共组件属性、默认值、协议输出、事务顺序、身份、迁移和独立应用见 [API 参考](../packages/textui-react/API.md)。该参考随 React npm 包一起打包。

## 示例

- `pnpm advanced-form [文件.md]`：默认 screens/advanced-form.md。直接修改 Name、Retries、Description；非法数字保留原文并在终端报告字段错误，修复保存后继续。Name/数字允许暂时清空；勾选 Submit 后由应用执行必填校验并写入 Result。Enable submission 控制 Submit 禁用，Owner 为只读。退出并重启恢复状态。
- `pnpm inline-markdown-showcase [文件.md]`：默认 screens/inline-markdown-showcase.md。修改 Status 并保存，验证格式转义、Unicode、嵌套 Link/Code、List 与 Table。
- `pnpm phase6 --help`：参数说明。Ctrl+C 保存已确认状态并退出。未修复的非法文件原样保留。

## 验证与预览打包

`pnpm check` 检查公开属性类型、旧回调兼容与依赖边界；`pnpm test` 包含 Phase 1～5 回归、Phase 6 共用事务契约、真实 Node 文件监听/恢复、局部更新和强制 CAS 竞争。`pnpm test:workers` 在无 Node 兼容的 workerd 执行同一份 Phase 6 契约，再执行既有 SQLite/帧流测试。`pnpm test:packed-worker` 安装独立 npm tarball，验证实际包入口及 Phase 6 契约。

三个包使用 0.0.0；全部检查通过后执行 `pnpm pack:preview`，产物在 .artifacts/preview/，供本地评审与应用验证。该命令只打包，不发布 npm，不部署 Worker。实验帧流仍在应用层。

## 本次验收记录（2026-10-04）

- 76 项 Node 测试通过（含原有 62 项）；真实文件 Host 覆盖两个新示例。
- 原有 8 项 Worker 测试通过；新增共用 Phase 6 契约在无 Node 兼容的 workerd 中通过。
- 公开 TypeScript 属性/旧事件兼容检查及平台依赖边界检查通过。
- 独立 tarball 消费者在 workerd 中通过 Phase 6 契约，确认没有工作区链接。
- 三个 0.0.0 本地预览包已生成；React 包包含 API.md。未发布 npm，未部署云端。
