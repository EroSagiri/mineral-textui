# Workers 兼容性测试

`pnpm test:workers` 构建三个包，启动本地 Wrangler/workerd，向测试 Worker 发起真实 HTTP 请求，确认同一 User 表单完成字段更新、互斥单选、双 Submit、反向更新和旧版本冲突检查。结束后关闭测试进程。

Wrangler 4.147.0，workerd 1.20261001.1；compatibility_date 为 2026-10-03。尝试客户端当天 2026-10-04 时当前本地运行时拒绝未来日期，因此使用其可接受的日期。

2026-08-04 起兼容日期默认开启 Node 模式，必须显式设置 no_nodejs_compat 和 no_nodejs_compat_v2；测试同时检查配置并在运行时确认无法导入 node:fs、没有 DOM document。

测试采用内存 Host，每个 HTTP 请求创建独立 Root 并在返回前关闭。没有持久云资源、远程绑定或云端部署；不包含生产 Cloudflare Host，也不证明多端订阅可靠性。

类型由 `pnpm --filter textui-worker-compat check` 中的 wrangler types 生成。生成文件不提交。

参考：[Cloudflare 兼容开关](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#nodejs-compatibility-flag)、[本地运行时](https://developers.cloudflare.com/workers/local-development/)。
