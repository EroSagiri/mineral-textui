# Worker 临时文本帧实验

复用 Phase 4 的 `DurableScreenPort`，每个应用 ID 对应一个 SQLite Durable Object。帧流完全处于应用层；三个正式包和 ScreenPort 不增加方法或依赖。本示例只供本地实验，没有登录/鉴权。

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm worker-animation
```

监听 `http://localhost:8788`，SQLite 数据保存在此示例的 `.wrangler/`，Ctrl+C 退出。另开终端订阅：

```sh
pnpm animation-client watch
```

第三个终端发送操作：

```sh
pnpm animation-client start
pnpm animation-client note "动画中编辑的备注"
pnpm animation-client pause
pnpm animation-client start
pnpm animation-client reset
```

可以同时打开两个 watch 客户端，二者都会收到帧。watch 客户端断线后每秒尝试重连，收到最新 snapshot 后接收帧，不补发历史；Ctrl+C 关闭连接和重连定时器。自定义应用地址使用环境变量 `TEXTUI_ANIMATION_URL`（默认 `http://localhost:8788/apps/demo/screens/build`）。

## HTTP 与 WebSocket

- `GET /apps/:app/screens/build` 返回 `{screen, instance, metrics, scheduled, subscribers}`。
- `PUT` 同一路径，JSON 为 `{text, expectedRevision}`。先 GET 最新文本，修改控件并保留协议标识，再携带该版本提交。陈旧版本返回 409；无效控件或 Block 返回 400。
- `GET /apps/:app/screens/build/subscribe` 使用 WebSocket Upgrade，主动订阅临时画面。开始连接先发送 `{type:'snapshot', screen, instance}`。
- 持久修改广播 `{type:'change', screen}`；临时推送为 `{type:'frame', frame:TextFrame}`。客户端发送字符串 `snapshot` 重新同步。

`TextFrame.markdown` 只是 `progress` Output 的覆盖层，不是整篇 Screen，也不能自动写回。只读持久 Screen 的编辑器只看到开始、暂停、重置、完成等持久状态，**看不到未持久化的中间帧**。Worker 的运行中持久进度固定在最近一次业务状态变化的位置。

`FrameReceiver` 严格检查 screen/target、当前动画 ID、revision、序号以及 2 秒有效期。版本不匹配时重取 snapshot；重复、乱序、被替换或过期的帧丢弃。连接恢复只需最新 Screen 和当前时间；高帧率应用优先在客户端用 `renderFrame(state, now)` 自行计算。

## 调度、恢复与检查

存在订阅者且状态为 running 才创建一个 250 ms 临时定时器；无订阅者、暂停、reset、完成后取消。每次推送重新读取持久状态；所有 HTTP、帧调度及 Alarm 在同一串行通道执行，旧任务不会跨新动画写回。

业务完成时间使用一个 Durable Object Alarm，重复执行对 completed 状态不再写入。只在完成时间改变时设置 Alarm，逐帧推送不反复写 Alarm。关闭订阅不取消业务 Alarm，任务仍可完成。[官方 Alarm 语义](https://developers.cloudflare.com/durable-objects/api/alarms/)为至少一次执行，因此完成处理保持幂等。

WebSocket 由 `acceptWebSocket` 接管，screen 关联和序号高水位使用附件保存。重新构造对象时从 SQLite Screen 和现存附件恢复，不依赖之前的 React Root；需要持久更新时创建 Root、恢复 Hook 状态、处理本次操作，然后关闭 Root。[官方 WebSocket Hibernation 说明](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)描述连接和附件的恢复方式。

```sh
pnpm --filter textui-worker-animation check
pnpm --filter textui-worker-animation test
pnpm test:workers
```

Vitest 的 Cloudflare 插件在真实 workerd 中测试多订阅、版本不变、断线清理、重连快照、完成、CAS 冲突、Alarm 幂等，以及实际驱逐后不同 instance 的重建。`evictDurableObject` 会等待活跃定时器结束，测试先调用应用的 `suspendFrameDelivery()` 取消临时调度，然后驱逐；SQLite、业务 Alarm 和 WebSocket 保留。此步骤不是模拟 React 重建，驱逐本身发生在真实 workerd；它也不声称验证了进程强杀或公网网络行为。

`metrics` 只统计当前 DO 实例的 Screen 写入、生成帧和帧消息，不持久化，驱逐后清零。临时帧没有 SQLite 表、缓存历史或可靠交付承诺。
