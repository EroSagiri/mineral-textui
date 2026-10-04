# Repository integration fixtures

这份工作台仅用于 Mineral TextUI 仓库的表单、任务、动画和旧 Worker API 回归，包含固定应用注册及旧 Host 代理；不属于通用 Devtools 包，不作为开发者入口。

`pnpm devtools:test:fixtures` 启动专用工作台和两个本地 Worker，运行浏览器回归。每次运行使用独立文件 Screen 目录，避免固定输入值被前次测试保留。核心编辑 / Preview 模块从 `devtools/src` 共享，测试应用与旧 Worker 协议适配留在此处。

开发自己的 App 使用 `pnpm devtools --app ...` 或 `textui.dev.ts`，见 `devtools/README.md`。
