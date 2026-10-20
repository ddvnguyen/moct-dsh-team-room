# 团队看板的运行时

[English](team-board-runtime.md) | 中文

这份说明记录 Team Board 这一串改动带来的运行时接缝：Task 现在拥有的持久化 op kind、Overview 读取的只读聚合、Orchestrator 摘要背后的 Host 侧定时器，以及管理从 Multica 移植文件的策略。这些接缝所处的边界见 [`host-authority.zh.md`](host-authority.zh.md) 与 [`client-and-remote.zh.md`](client-and-remote.zh.md)；协作语义见 [`../team-collaboration/`](../team-collaboration/README.zh.md)。

## Task 的 op kind

两条持久化记录承载看板需要的 Task 字段。两者都是只追加的 ledger 操作，因此都能同样重放，而没有它们的旧 ledger 重放结果不变。

`team/task-created` 是一次提交：开头 Message、Task 覆盖层、Thread 与 Inbox 增量一起落盘，因此 Task 不会脱离打开它的 Message 而存在。

`team/task-updated` 携带 `baseRevision` 与 `title`、`priority`、`assignee`、`position` 的补丁。它从不修订 Thread 的 Message。当补丁把 Task 换给另一个 Member 时，同一条记录携带公开的 `assign` Activity——新负责人的唤醒是这条记录的投影，而不是提交的副作用，因此重放会推导出同样的唤醒。

状态不在这几个字段里。验收、关闭与重新打开走 `team/task-changed`，因为它们是对 Task 所做工作的决定，而不是对 Task 描述的改变。

## workspaceActivity Remote

`workspaceActivity` 是一个 Workspace 范围的只读聚合：它一次返回每个 Channel 的 `roomActivity` 折叠结果，再加上按天的消耗桶。它读取 ledger 与 Session 运行记录；不写任何东西，不开收据，不标记未读，也不唤醒任何人。

| 字段 | 含义 |
| --- | --- |
| `totals` | Workspace 自身的汇总，形状与 `roomActivity` 对单个 Channel 返回的一致。 |
| `perAgent` | 每个 Member 在这些汇总中的份额。 |
| `perDay` | 每个本地日一个桶：输入输出 token、运行时长，以及当天每个 Member 的份额。 |
| `sessions` | 这些数字背后的 Session 运行记录。 |
| `events` | 最新在前的动态流，用不透明的 `cursor` 分页（默认 50 行，上限 200）。 |

这个聚合是对 `roomActivity` 折叠的一次扩展，而不是它的第二份实现：Workspace 作用域向同一个投影要遍所有 Channel，再加上按天分桶。因此它不需要 Channel ref，Workspace 在任何 Channel 存在之前就能作答，空 Workspace 也是合法的空聚合。

Client 的 Overview 页面读取它，并跟随 `workspace` 与 `activity` 两个变更作用域。

## 摘要定时器

摘要跑在 Host 侧的定时器上，而不是 Harness 的 schedule 服务上：schedule 提醒绑定的是某一个 Session id，而 Member 的 Session 会在 rollover 与续期时更换。定时器自行重设，并在每次触发时解析当前席位。

它的配置是 Team Host 行的 `digest` 段，每个字段都是易失的，因此改动无需重启就能落到运行中的 Host 上。

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `enabled` | 定时器是否运行 | `false` |
| `intervalMinutes` | 两次触发之间的分钟数，也是摘要汇报的时间窗 | `1440` |
| `dailyAt` | 可选的每日触发时间 `HH:MM`（Host 本地时区）；它替代间隔作为触发计划 | 未设置 |
| `channel` | 摘要发到哪个 Channel；缺失时创建 | `team-digest` |

触发时，每个空闲的、已启用的 Orchestrator 都会通过 `agent.followup` 收到一条只汇报的指令；忙碌的 Member 会被跳过，交给下一次触发处理——摘要绝不该去干预正在跑的 Turn。摘要本身不新增 op kind：汇报本身就是 digest Channel 里一条普通的 `team/message-sent`，而这个 Channel 在第一次触发时若不存在就会被创建。

只读的 `team_activity` 工具就是那条指令背后的快照：每个 Agent 的状态、带时长的 Task 分类、待决策卡片以及窗口内最显著的事件，并且带有明确的截断标记。

## Multica 复用策略

看板、Task 详情、Agent 页面、总览与收件箱都是 Multica 界面的移植。移植代码位于 `packages/client-agent-team/src/client/multica/` 与 `multica-ui/`，紧邻 `multica-look.module.css` 这一层外观；任何开头注释提到 `multica-x` 的其他文件也带同样的头部。

每个移植文件开头都写明它的来源与取自哪个上游 commit：

```ts
// Derived from multica-x packages/views/issues/components/status-icon.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
```

`npm run check:multica`（`scripts/check-multica-provenance.mjs`）断言三件事：每个移植文件都带这个头部；Client 源码不导入任何 `@multica/*` 说明符（Multica 自己的包绑在 Multica 的服务端 API 上）；头部里写下的每个 commit 都在 `NOTICE` 中固定。

重新同步一个移植文件是拿它头部写明的那个 commit 做 diff，而不是从上游重新拷贝：取上游文件在该 commit 的版本，重新套用头部第二段注释记录的本仓库适配，然后把固定点同时推进到头部与 `NOTICE`。`NOTICE` 固定两个 commit——源文件的 commit 与外观 token 的 commit——并说明后者是前者的祖先，因此两者一起推进。
