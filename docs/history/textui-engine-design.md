# TextUI Engine 设计说明书

> 一个文本驱动的 UI 引擎：文件 = 屏幕，纯文本 = 协议，编辑器无关。

## 1. 概述

### 1.1 问题域

UI 通常绑定到特定渲染器（浏览器、终端、原生控件）。我们要构建一个引擎，让：

- 用户可以用**记事本** / VS Code / Obsidian 操作 UI
- **服务器**可以推送文本驱动 UI（任意后端）
- 客户端**可选地用** React / Ink / 任何渲染器增强

### 1.2 核心约束

- **底层纯文本**：所有 UI 状态用 ASCII 字符表达
- **编辑器可选增强**：可点击、可渲染、可折叠，但**不绕过字符**
- **记事本可操作性**：不依赖任何编辑器特性

### 1.3 vs 其他范式

| 范式 | 渲染目标 | 编辑器依赖 | 协作 |
|---|---|---|---|
| **TUI**（blessed/ink） | ANSI 终端 | 必须 terminal | 否 |
| **Web UI**（React/Vue） | 浏览器 DOM | 必须浏览器 | 否 |
| **TextUI Engine** | 纯文本文件 | **否**（记事本都行） | 是 |

TUI ≈ IM（实时聊天）；TextUI ≈ Email（异步、可持久）。

## 2. 设计原则

### P1. 字符即真相
- 所有状态用 ASCII 字符表达（`[x]` / `[value]` / `[meta:k=v]`）
- 增强层不维护独立 state
- 所有变更必须改写字符，不绕过字符

### P2. 双层契约
- **Layer 1（必须）**：纯文本协议，任何编辑器都能读写
- **Layer 2（可选）**：编辑器增强（点击、自动补全、渲染），通过改写字符工作

### P3. 编辑器无关
- 不假设任何特定编辑器
- 不假设 markdown 渲染
- 不假设 click handler / Properties 面板存在

### P4. 渐进增强
- 没 Obsidian？记事本能用
- 有 Obsidian？点击更快
- 增强失效 → Layer 1 仍工作

### P5. 失败回退
- 字符损坏 → 用户手动修复（记事本 + sed）
- 协议升级 → 旧字符兼容
- 增强层崩溃 → Layer 1 仍可用

### P6. Unix 哲学
- Engine 只做一件事：文本 IO（文件 ↔ 屏幕）
- 所有智能在应用层
- 小内核，大生态

## 3. 核心抽象

### 3.1 文件 = 屏幕

```
文件路径 = 屏幕 ID
文件内容 = 屏幕状态
文件变更 = 屏幕更新
```

**一个文件 = 一个屏幕**。多屏幕 = 多文件。

### 3.2 Screen 最小 API

```ts
class Screen {
  constructor(filePath: string)

  // === 操作 1：改变显示 ===
  setContent(text: string): void

  // === 操作 2：监听更改 ===
  onChange(handler: (change: ContentChange) => void): Unsubscribe

  // === 当前状态 ===
  getContent(): string
}

interface ContentChange {
  before: string       // 旧内容
  after: string        // 新内容
  epoch: number        // 回环保护
  ops: DiffOp[]        // 行级 diff
}

interface DiffOp {
  type: 'add' | 'remove' | 'modify'
  line: number
  before?: string
  after?: string
}
```

**就这五个方法 / 字段**。Engine 不懂业务，不知道 checkbox / input 是什么。

### 3.3 Epoch 回环保护

```ts
private writeEpoch = 0

setContent(text: string): void {
  this.writeEpoch++
  const stamped = injectEpoch(text, this.writeEpoch)
  fs.writeFileSync(filePath, stamped)
}

// chokidar 触发时：
if (parseEpoch(newContent) === this.writeEpoch) return
// 自己写的，跳过，避免无限循环
```

## 4. 架构

### 4.1 总览

```
┌─────────────────────────────────────────────────────────┐
│  Layer 2 (Optional Enhancement)                          │
│  ── React / Ink / Obsidian / 浏览器                    │
│  ── 增强体验（点击、布局、动画）                        │
│  ── 必须通过改写字符工作                                 │
└──────────────────────┬──────────────────────────────────┘
                       │ useScreen / useCheck / useInput
                       ▼
┌─────────────────────────────────────────────────────────┐
│  App Layer                                               │
│  ── 业务逻辑（围棋规则 / 表单验证 / 游戏状态）         │
│  ── state 管理 / handlers                               │
│  ── deriveEvents / UIEventBus                          │
└──────────────────────┬──────────────────────────────────┘
                       │ onChange
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Engine (Screen)                                         │
│  ── setContent / onChange / getContent                  │
│  ── chokidar watch + epoch 回环保护                     │
└──────────────────────┬──────────────────────────────────┘
                       │ fs.writeFileSync / fs.readFileSync
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 1 (Pure Text Protocol)                            │
│  ── 文件 (.md)                                           │
│  ── ASCII 字符协议                                       │
│  ── 记事本 / cat / sed 都能操作                          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 状态流

```
                        ┌──────────────────┐
                        │  state (memory)  │ ← single source of truth
                        └────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                    │
              ▼                                    ▼
   ┌──────────────────────┐            ┌──────────────────────┐
   │  Layer 1             │            │  Layer 2             │
   │  ──────────          │            │  ──────────          │
   │  renderToString()    │            │  ReactDOM.render()   │
   │       ↓              │            │       ↓              │
   │  markdown string     │            │  DOM (pixels)        │
   │       ↓              │            │                      │
   │  fs.writeFileSync()  │            │  浏览器 / Obsidian   │
   └──────────┬───────────┘            └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  file (.md)          │
   │  epoch++             │
   └──────────┬───────────┘
              │ chokidar 'change'
              ▼
   ┌──────────────────────┐
   │  epoch 匹配？         │
   │  ├─ 是：skip (echo)  │
   │  └─ 否：onChange     │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │  App 处理            │
   │  deriveEvents        │
   │  state 更新          │
   └──────────────────────┘
```

## 5. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 语言 | **TypeScript** | 类型安全，编辑器友好 |
| Markdown 解析 | **unified** + **remark-parse** + **remark-gfm** | 标准生态，typed AST（mdast） |
| Markdown 序列化 | **remark-stringify** | AST → 字符串 |
| 文件监听 | **chokidar** | 跨平台稳定，Node/Electron 通用 |
| 自定义渲染器 | **react-reconciler** | 用 React 写 widget，渲染到 markdown |
| React 桥接 | **React 18 useSyncExternalStore** | 官方外部 store 订阅 API |
| Diff | **自写**（行级 ~50 行） | 没有完美 mdast diff |
| Schema 验证 | **zod** | UISchema 运行时验证 |
| 测试 | **vitest** | 已经在用，快 |
| 文件 IO | **Node fs / fs/promises** | 标准库 |
| 持久化（可选） | **lowdb** / **better-sqlite3** | 本地 JSON / SQL |

### 不要用

| 库 | 原因 |
|---|---|
| CodeMirror / Monaco | 绑死编辑器 |
| TipTap / ProseMirror / Slate | 绑死编辑器 |
| blessed / ink | 绑死 terminal |
| Lexical / Plate | 绑死编辑器 |
| 任何"渲染器绑定"库 | 违反编辑器无关原则 |

## 6. 协议规范

### 6.1 ASCII 字符协议

```markdown
== 标题 ==
========

[ ] checkbox 未选
[x] checkbox 选中
( ) radio 未选
(*) radio 选中
[y] yes
[n] no

> label: [value]              # input 有值
> label: [placeholder]         # input 占位符

[meta:key=value key=value]     # 元数据（sentinel）

---                            # 分隔线

[lock-start]                   # 锁定区开始
(锁定内容 - 服务器覆盖)
[lock-end]                     # 锁定区结束
```

### 6.2 解析 Pattern（纯 ASCII regex）

```ts
export const PATTERNS = {
  checkbox: /^\s*\[([ xX])\]\s*(.*)$/,
  radio:    /^\s*\(([ xX*])\)\s*(.*)$/,
  yesno:    /^\s*\[([ynYN])\]\s*(.*)$/,
  input:    /^\s*>\s*([^:]+):\s*\[([^\]]*)\]/,
  meta:     /^\s*\[meta:([^\]]+)\]/,
  locked:   /^\s*\[(lock-start|lock-end)\]\s*$/,
  heading:  /^=+\s*(.*?)\s*=+\s*$/,
  divider:  /^-+$/,
  blank:    /^\s*$/,
}
```

### 6.3 序列化（toMarkdown）

每个 Widget 类实现 `toMarkdown()`：

```ts
class Heading {
  constructor(public text: string, public level = 1) {}
  toMarkdown(): string {
    const marker = '='.repeat(this.text.length + 4)
    return `${marker}\n== ${this.text} ==\n${marker}\n`
  }
}

class Checkbox {
  constructor(public label: string, public checked: boolean) {}
  toMarkdown(): string {
    return `${this.checked ? '[x]' : '[ ]'} ${this.label}\n`
  }
}

class Input {
  constructor(public label: string, public value: string, public placeholder = '') {}
  toMarkdown(): string {
    return `> ${this.label}: [${this.value || this.placeholder}]\n`
  }
}
```

## 7. 数据流

### 7.1 记事本编辑流程

```
记事本：- [ ] 男 → - [x] 男
        ↓
chokidar 'change' 事件
        ↓
Screen 读文件，提取 epoch
        ↓
epoch 匹配？
├─ 是 → skip（自己写的）
└─ 否 → 继续
        ↓
onChange(before, after, epoch, ops)
        ↓
App.deriveEvents(before, after) → UIEvent[]
        ↓
UIEventBus 派发
├─ check (离散)  → 立即触发
└─ input (连续)  → debounce 300ms
        ↓
handlers 处理
        ↓
state 变更 → renderToString → markdown
        ↓
Screen.setContent(markdown)
        ↓
fs.writeFileSync + epoch++
        ↓
chokidar 触发（epoch 匹配 → skip）
```

### 7.2 React 编辑流程

```
React 组件 onChange
        ↓
handler(newValue)
        ↓
state 变更（in-memory）
        ↓
renderToString(<Widget state={newState} />)
        ↓
Screen.setContent(markdown)
        ↓
fs.writeFileSync + epoch++
        ↓
chokidar 触发（epoch 匹配 → skip）
        ↓
React 重渲染（来自 useScreen 订阅 state）
```

### 7.3 服务器同步流程

```
服务器 push（WebSocket / hot-sync）
        ↓
客户端 Screen.setContent(serverText)
        ↓
fs.writeFileSync + epoch++
        ↓
chokidar 触发（epoch 匹配 → skip 本地 React）
        ↓
useScreen 触发重渲染
        ↓
React 显示新内容
```

### 7.4 收敛式 UI（服务器覆盖）

```
客户端修改 → 文件变更 → chokidar 触发
                            ↓
                    epoch 不匹配（不是自己写的）
                            ↓
                    onChange(before, after)
                            ↓
                    App 检测：用户改了 [lock-region] 内的内容
                            ↓
                    App 决定：revert（写回服务器版本）
                            ↓
                    Screen.setContent(serverVersion)
                            ↓
                    客户端修改被覆盖，UI 回到合法状态
```

## 8. 事件模型

### 8.1 Engine 原始事件（只有 1 个）

```ts
screen.onChange((change: ContentChange) => {
  // change.before / change.after / change.epoch / change.ops
})
```

### 8.2 应用层 UIEvent（派生）

```ts
export type UIEvent =
  // === 离散事件：完整状态切换 ===
  | { kind: 'check';    field: string; before: boolean; after: boolean }
  | { kind: 'select';   field: string; before: string | null; after: string | null }
  | { kind: 'submit';   field: string; value: string }
  | { kind: 'reset' }
  
  // === 连续事件：增量字符变化 ===
  | { kind: 'input';    field: string; before: string; after: string }
```

### 8.3 离散 vs 连续

| 类型 | 控件 | 触发 | debounce |
|---|---|---|---|
| **离散** | checkbox / radio / submit | 一次操作 = 一次事件 | 不需要 |
| **连续** | input / textarea | 每 keystroke = 一次事件 | 默认 300ms（应用层决定） |

### 8.4 派生规则

```ts
export function deriveEvents(before: UISchema, after: UISchema): UIEvent[] {
  const events: UIEvent[] = []
  
  // checkbox 离散
  for (const key of Object.keys(after.checkboxes)) {
    const beforeVal = before.checkboxes[key] ?? false
    const afterVal = after.checkboxes[key]
    if (beforeVal !== afterVal) {
      events.push({
        kind: 'check',
        field: key,
        before: beforeVal,
        after: afterVal
      })
    }
  }
  
  // radio / select 离散
  for (const key of Object.keys(after.selects)) {
    if (before.selects[key] !== after.selects[key]) {
      events.push({
        kind: 'select',
        field: key,
        before: before.selects[key] ?? null,
        after: after.selects[key] ?? null
      })
    }
  }
  
  // input 连续（每次都触发，由 EventBus debounce）
  for (const key of Object.keys(after.inputs)) {
    const beforeVal = before.inputs[key] ?? ''
    const afterVal = after.inputs[key] ?? ''
    if (beforeVal !== afterVal) {
      events.push({
        kind: 'input',
        field: key,
        before: beforeVal,
        after: afterVal
      })
    }
  }
  
  return events
}
```

### 8.5 debounce 策略（应用层决定）

Engine **不做** debounce。EventBus 提供可选的 debounce，应用层根据场景选择：

```ts
// 实时反馈：无 debounce
bus.on('input', e => liveUpdate(e.after))

// 默认：300ms
bus.on('input', e => saveDraft(e.after))

// 表单字段：500ms
bus.on('input', e => autoSave(e.after))
```

## 9. API 设计

### 9.1 Screen（核心）

```ts
export class Screen {
  constructor(filePath: string)

  // 写：改变屏幕
  setContent(text: string): void

  // 监听：内容变化
  onChange(handler: (change: ContentChange) => void): () => void

  // 读：当前状态
  getContent(): string
}
```

### 9.2 UIEventBus（应用层）

```ts
export class UIEventBus {
  constructor(screen: Screen)

  // 订阅特定事件
  on<T extends UIEvent>(
    kind: T['kind'],
    handler: (e: T) => void
  ): () => void

  // 订阅所有事件
  onAny(handler: (e: UIEvent) => void): () => void
}
```

### 9.3 React Hooks

```tsx
// 订阅 Screen 内容
function useScreen(screen: Screen): [string, (text: string) => void]

// 订阅离散事件
function useCheck(
  bus: UIEventBus,
  field: string,
  handler: (before: boolean, after: boolean) => void
): void

function useSelect(
  bus: UIEventBus,
  field: string,
  handler: (before: string | null, after: string | null) => void
): void

// 订阅连续事件（带 debounce）
function useInput(
  bus: UIEventBus,
  field: string,
  handler: (value: string) => void,
  debounceMs?: number
): void

// 订阅任意事件
function useUIEvent<T extends UIEvent>(
  bus: UIEventBus,
  kind: T['kind'],
  handler: (e: T) => void
): void
```

### 9.4 Widgets（React 组件）

```tsx
<Screen />          // 容器
<Heading />         // 标题
<Checkbox />        // 复选框
<Radio />           // 单选
<Input />           // 文本输入
<Meta />            // 元数据
<Divider />         // 分隔
<Grid />            // 棋盘（围棋/数独/俄罗斯方块通用）
<Locked />          // 锁定区
```

## 10. 目录结构

```
textui-engine/
├── src/
│   ├── screen.ts             # Screen 核心类
│   ├── events.ts             # UIEvent 类型 + deriveEvents
│   ├── event-bus.ts          # UIEventBus
│   ├── parse.ts              # markdown → UISchema
│   ├── serialize.ts          # UISchema → markdown
│   ├── diff.ts               # 行级 diff
│   ├── widgets.tsx           # React widget 组件
│   ├── renderer.tsx          # react-reconciler host config
│   ├── react-hooks.ts        # useScreen / useCheck / useInput
│   └── index.ts              # 导出
├── apps/
│   ├── go-game/              # 围棋 app
│   │   ├── index.ts
│   │   ├── state.ts          # 围棋规则
│   │   ├── ai.ts             # AI（随机/贪心/MCTS）
│   │   └── widget.tsx        # GoBoard React 组件
│   ├── snake/                # 贪吃蛇
│   ├── tetris/               # 俄罗斯方块
│   ├── sudoku/               # 数独
│   └── form/                 # 表单示例
├── examples/
│   ├── go-game.md            # 围棋示例文件
│   ├── snake.md
│   └── form.md
├── tests/
│   ├── screen.test.ts
│   ├── parse.test.ts
│   ├── serialize.test.ts
│   ├── diff.test.ts
│   └── derive.test.ts
├── package.json
└── tsconfig.json
```

## 11. 流程图

### 11.1 启动流程

```
┌──────────────────────────────────────┐
│  App 启动                             │
│  ── new Screen('./围棋.md')          │
└──────────────────┬───────────────────┘
                   ↓
┌──────────────────────────────────────┐
│  Screen 初始化                        │
│  ── 读文件 → content                  │
│  ── 启动 chokidar watch              │
│  ── writeEpoch = 0                    │
└──────────────────┬───────────────────┘
                   ↓
┌──────────────────────────────────────┐
│  App 加载初始 state                   │
│  ── new UIEventBus(screen)           │
│  ── 订阅 events                       │
│  ── renderToString(initialState)     │
└──────────────────┬───────────────────┘
                   ↓
┌──────────────────────────────────────┐
│  Screen.setContent(markdown)          │
│  ── writeEpoch++                     │
│  ── fs.writeFileSync                 │
└──────────────────┬───────────────────┘
                   ↓
┌──────────────────────────────────────┐
│  chokidar 'change'                    │
│  ── epoch 匹配 → skip                │
│  ── 启动完成                          │
└──────────────────────────────────────┘
```

### 11.2 编辑循环（完整）

```
            ┌──────────────────────────────┐
            │                              │
            ▼                              │
   ┌─────────────────┐              ┌─────┴──────┐
   │  file (.md)     │              │  User       │
   │  state on disk  │              │  (记事本/   │
   └────────┬────────┘              │  React)     │
            │                       └─────┬───────┘
            │ chokidar                     │
            │ 'change'                     │
            ▼                              │
   ┌─────────────────┐                    │
   │  Screen         │                    │
   │  ── read file   │                    │
   │  ── parse epoch │                    │
   │  ── skip if     │                    │
   │     match       │                    │
   └────────┬────────┘                    │
            │ onChange(before, after)     │
            ▼                             │
   ┌─────────────────┐                    │
   │  App            │                    │
   │  ── parse       │                    │
   │  ── derive      │                    │
   │     events      │                    │
   └────────┬────────┘                    │
            │ dispatch events             │
            ▼                             │
   ┌─────────────────┐                    │
   │  UIEventBus     │                    │
   │  ── check       │ (immediate)        │
   │  ── input       │ (debounce 300ms)   │
   └────────┬────────┘                    │
            │ handlers                    │
            ▼                             │
   ┌─────────────────┐                    │
   │  state 变更     │ ◄──────────────────┘
   │  ── new state   │
   │  ── render md   │
   └────────┬────────┘
            │ setContent
            ▼
   ┌─────────────────┐
   │  write file     │
   │  ── epoch++     │
   │  ── chokidar    │
   │     (skip)      │
   └─────────────────┘
```

## 12. 落地路径

### Phase 1: Screen 核心（半天）
- `Screen` 类：setContent / onChange / getContent
- chokidar watch
- epoch 回环保护
- 测试：写→触发→skip

### Phase 2: Parse + Diff（半天）
- `parseTextUI(content)` → UISchema
- `lineDiff(before, after)` → DiffOp[]
- 测试：解析各种 markdown 输入

### Phase 3: UIEventBus（半天）
- `deriveEvents(before, after)` → UIEvent[]
- UIEventBus 派发
- input debounce（默认 300ms）

### Phase 4: React 桥接（半天）
- `useScreen(screen)`
- `useCheck / useInput / useUIEvent`
- 测试：hooks 订阅 / 卸载 / 重渲染

### Phase 5: 自定义渲染器（半天）
- `react-reconciler` host config
- `renderToString(<Widget />)`
- Widgets 组件（Heading / Checkbox / Input / Meta / Divider）

### Phase 6: 第一个 App（半天）
- 围棋菜单
- 记事本勾选 → log

### Phase 7: Grid Widget（半天）
- 围棋棋盘 19×19
- 坐标输入

### Phase 8: 双进程测试（1 天）
- 客户端进程：watch + parse + 渲染
- 服务器进程：围棋 AI（随机/贪心）
- 通信：本地 HTTP 或 WebSocket

### Phase 9: Cloudflare 部署（2 天）
- 服务器跑在 Worker 上
- 客户端通过 hot-sync 通道
- 完整端到端：vault `围棋.md` ↔ gateway DO

## 13. 风险与限制

### 风险

| 风险 | 缓解 |
|---|---|
| epoch 冲突或丢失 → 无限循环 | epoch 用 monotonic counter，进程启动时从 0 开始 |
| 解析歧义 → schema 不一致 | parser 容错，revert 不合法改动（用 `[lock-region]`） |
| 大文件 diff 性能差 | 行级 diff + 增量渲染；超过阈值用 stream diff |
| 字符协议歧义 | regex 严格；预留 `<!-- meta:schema=v2 -->` 升级机制 |

### 限制

| 限制 | 说明 | 缓解 |
|---|---|---|
| 没有真正布局 | Layer 1 是顺序流 | Layer 2 React 提供 flex / grid |
| 没有颜色 / 动画 | 纯 ASCII | Layer 2 CSS / animation |
| 没有 cursor 定位 | 用户只能在文本级别操作 | Layer 2 完整 DOM（click handler） |
| 大棋盘性能差 | 19×19 = 361 字符 | Layer 2 click handler；坐标输入作为备选 |
| 编辑冲突（多人同时改） | last-write-wins | 后续接 CRDT（Yjs） |
| 移动端打字体验 | input 字段小 | Layer 2 渲染成 `<input>` 控件 |

## 14. 关键决策记录

### D1. Engine 只发 1 个原始事件
- `change` 事件，before / after / epoch / ops
- 应用层派生所有结构化事件
- **理由**：Engine 不懂业务，事件类型可灵活扩展

### D2. 文件 = 屏幕
- 一个文件 = 一个 UI 屏幕
- 不存在多屏幕概念
- **理由**：最小化抽象，符合 Unix 哲学

### D3. 离散 vs 连续事件分离
- checkbox / radio = 离散（一次操作 = 一次事件）
- input = 连续（每 keystroke = 一次事件，debounce 由应用层决定）
- **理由**：语义不同，触发频率不同

### D4. Engine 不做 debounce
- debounce 由应用层 / EventBus 决定
- **理由**：不同场景需要不同策略（搜索框 300ms / 表单 500ms / 实时 0ms）

### D5. React 是 Layer 2，不是核心
- React 是可选的增强层
- Engine 不依赖 React
- **理由**：编辑器无关原则；记事本也能用

### D6. epoch 用 Lamport 时间戳
- 每次写 +1
- chokidar 读 epoch 匹配则跳过
- **理由**：经典回环保护，简单可靠

### D7. 协议基于 ASCII，不用 markdown 语义特性
- 不用 `[[wikilink]]` 自动补全
- 不用 callout 指令（`> [!note]`）
- 不用 frontmatter UI
- **理由**：记事本可读、可写、可 grep

### D8. Layer 2 增强必须通过改写字符工作
- React onClick → 写回 `[x]` / `[ ]`
- React input → 写回 `[value]`
- 不绕过字符
- **理由**：保证 Layer 1 仍是真相

### D9. App 通过 state → renderToString → setContent 写文件
- 不直接 fs.writeFileSync
- **理由**：统一写路径，epoch 在 Screen 层管理

### D10. 双层渲染共享 state
- 同一 React 组件树：markdown（Layer 1）+ DOM（Layer 2）
- **理由**：单一真相，两份输出

## 15. 验收标准

### Phase 1 验收
- ✅ `Screen.setContent` 写入文件
- ✅ chokidar 触发 onChange
- ✅ 自己写的被 skip（不触发 onChange）
- ✅ 记事本编辑触发 onChange

### Phase 3 验收
- ✅ checkbox 变化派发 `check` 事件
- ✅ input 变化派发 `input` 事件（debounce 300ms）
- ✅ 同一字段多次 input 只触发一次（debounce 生效）

### Phase 5 验收
- ✅ React 组件 → renderToString → markdown
- ✅ markdown → parseTextUI → UISchema
- ✅ round-trip 一致性（serialize ∘ parse = identity）

### Phase 6 验收（围棋）
- ✅ 记事本勾选「开始游戏」→ 服务器收到 → 写棋盘
- ✅ 记事本输入 `D4` → 服务器落子 → AI 回应 → 棋盘更新
- ✅ React 点击 D4 → 写文件 `[D4]` → 服务器读 → 落子

### Phase 9 验收（Cloudflare）
- ✅ vault `围棋.md` ↔ gateway `GoGameSessionDO`
- ✅ 多端同步：Obsidian 桌面 + Obsidian 移动 + 记事本 都能玩
- ✅ 服务器 AI 落子 → push → 客户端渲染

## 16. 参考资料

### 已有项目
- **Pluto.jl** / **Marimo**：reactive notebook，文件 = state
- **Ink**：React for CLI（用 react-reconciler 渲染到 ANSI）
- **react-pdf**：React for PDF（用 react-reconciler 渲染到 PDF）
- **Markdoc**（Stripe）：schema-driven markdown
- **Org-mode**：纯文本 agenda / todo
- **todo.txt**：纯文本 todo 格式
- **Obsidian Tasks**：task list 状态管理
- **Yjs**：CRDT（多客户端协同时考虑）

### 标准协议
- **JSON Patch**（RFC 6902）：HTTP PATCH 标准
- **CRDT**：冲突无关复制数据类型
- **Lamport Timestamps**：分布式时钟

### 文档
- [react-reconciler](https://www.npmjs.com/package/react-reconciler)：React 自定义渲染器接口
- [unified](https://unifiedjs.com/)：markdown 处理生态
- [chokidar](https://github.com/paulmillr/chokidar)：Node 文件监听

---

**版本**：v0.1.0 · 2026-10-03
**作者**：June & Mavis
**状态**：设计中
