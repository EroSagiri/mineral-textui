# Phase 5：Animation & Frame Streaming

## 实现范围

实现位于 `examples/animation-demo` 和 `examples/worker-animation`。Core、React Runtime、Node Host 的源代码和公开契约保持本阶段开始时的状态，不新增正式包。动画状态由现有 Block + `useTextState` 保存，Output 渲染低频进度，Action 同步执行开始、暂停、恢复与重置。动画计算显式接受时间，不读取系统时钟、不创建定时器。

`AnimationState` 包含 ID、status、startedAt、durationMs、elapsedBeforePauseMs。暂停、恢复、重置和再次开始均使旧实例失效。恢复 running 状态时，以累计暂停前时间 + 当前运行段时间计算进度；若已经超过持续时间，直接完成。无需历史帧，也不会重放已被确认的 Action。

持久更新继续由原有 React Runtime 的 CAS、重新读取、hydrate、patch 流程处理。实验测试在写入前插入一次真正的版本竞争，验证重算后保留 Input 和普通 Markdown；没有重发整篇旧文本。临时帧无法调用 ScreenPort。

## 性能报告

2026-10-04，Windows，Node.js v24.12.0，真实 Node 文件 Host，注入时钟模拟 10 秒任务。开始操作已经完成后计数，含最后完成，不含初始化/Action 确认。`pnpm measure:animation` 可复现。

| 模式 | 持久文件写入 | 临时帧 | 帧消息（2 订阅者） | 帧 JSON 字节总量 | 本次运行耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Markdown，1 fps | 10 | 0 | 0 | 0 | 328.94 ms |
| 临时帧，4 fps | 1 | 40 | 80 | 15,262 | 111.36 ms |

字节数仅计算 TextFrame JSON，不含 WebSocket 外层、协议和持久 change 消息。运行耗时是模拟时间加速后的本地总耗时，含文件 I/O 和 React 处理；不是 10 秒真实调度耗时、CPU 使用率或公网延迟，且单次样本不能作为稳定吞吐承诺。临时流减少了持久写入，但消息量随订阅者数增长。

真实 workerd 的独立测量测试在约 1.1 秒窗口里让 2 个 WebSocket 订阅者接收 250 ms 调度帧，断言至少 4 个帧、每帧 2 条消息、0 次中间 Screen 写入及 revision 不变。这个测试还包含窗口末尾主动读取触发的最新帧，不把消息数视为精确固定帧率。无订阅者和完成后的静默窗口验证帧计数不再增长。

此外直接启动 `pnpm worker-animation`，通过 Node 原生 WebSocket 连接本地 Wrangler/workerd 实测：1,146 ms 窗口，5 个帧、10 条帧消息、0 次 Screen 写入，revision 不变。5 帧包含窗口末尾读取触发的即时帧。暂停及断开两条连接后 `scheduled=false`。`pnpm animation-demo` 也实际启动，通过编辑生成文件验证开始、进度刷新、备注保留和暂停。

## 技术决策：Frame Stream 暂留应用层

此次实验说明持久状态与临时画面可以分离：普通文本编辑器保留可恢复的业务状态；主动订阅者看到中间帧；三种正式包无需了解帧传输。`FrameStream` 和 `TextFrame` 是实验接口，不承诺稳定 API。

暂不提取正式可选包。当前只有示例中的一个目标 Output，尚无第二个真实应用验证多目标生命周期、背压策略、权限和传输选择。应用层严格 revision 校验也会在任意持久编辑后要求重新同步，适合保守实验，但未证明是通用策略。

后续若至少两个应用需要相同订阅生命周期、乱序处理与状态同步，再提取无 Host 依赖的可选帧协议/接收器，具体 WebSocket 或其他传输仍由应用适配。高频视觉应优先由客户端据状态与时间计算；服务端不提供可靠逐帧传输或永久动画服务。

## 验收证据

- Node/Vitest：纯函数与边界、暂停恢复重置、低频 Markdown、相同文本零调用、真实文件监听和 Host 重建、强制 CAS 冲突、旧帧失效、取消调度。
- workerd/Vitest：多订阅推送、SQLite revision 不变、普通编辑、陈旧写入拒绝、断线无定时器、重连最新快照、真实 DO 驱逐与附件恢复、Alarm 完成及重复执行、无效 Block/删除目标拒绝、完成后静默。
- 现有 Phase 1～4 测试、类型检查和依赖边界检查保留于根命令中。
- 驱逐前需要显式取消临时定时器，以满足 workerd 驱逐助手的活动引用排空要求；恢复阶段验证新 instance、相同持久状态和存活连接。未部署公开云端。

运行步骤见两个示例目录的 README。
