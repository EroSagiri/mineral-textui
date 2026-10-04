# Node.js 动画示例

在仓库根目录运行（Node.js 24+）：

```sh
pnpm install --frozen-lockfile
pnpm animation-demo
```

打开终端显示的 `screens/animation-demo/build.md`，保留协议注释和动画 Block。把 Start / Resume 前的 `[ ]` 改为 `[x]` 并保存，开始默认 10 秒任务。Pause 暂停；再次 Start / Resume 恢复；Reset 换掉动画 ID 并回到 idle。Action 自动取消勾选。在 Note 输入框里编辑文字，或添加普通 Markdown 备注，动画更新会保留它们。

持久进度每秒最多更新一次，输出相同的 tick 不调用 ScreenPort；暂停、完成、idle 均无动画定时器。Ctrl+C 关闭调度、React Root、订阅和文件 Host。重启相同命令会从 Block 恢复状态，并按当前时间直接显示进度；运行期间退出后，时间仍继续经过，错过的帧不会重播。

`animation.ts` 是纯计算和 Block codec；`clock.ts` 注入时间与调度；`app.tsx` 使用现有 Output、Action、Block 和 `useTextState`，状态不是仅保存在 React 内存里。`createAnimationApp(host, clock)` 可接受 `ManualClock` 来测试边界、恢复与清理。生产示例采用 `systemClock`。

```sh
pnpm test
pnpm measure:animation
```

测量命令使用模拟时钟驱动真实 Node 文件 Host，完成后删除自己的临时目录。指标只计算开始操作完成之后的进度/完成写入；不包含首次创建、用户编辑和 Action 确认。

Worker 命令行订阅客户端也放在此目录（它需要 Node.js）：见 [Worker 说明](../worker-animation/README.md)。
