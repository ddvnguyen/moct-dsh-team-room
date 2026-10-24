# 团队看板

[English](team-board.md) | 中文

团队看板（Team Board）是 Human 观察运行中 Agent 团队的地方：Workspace 里全部 Task 的 kanban、单个 Task 的详情与背后的运行记录、说明团队此刻在做什么的页面、告诉 Human 什么需要处理的收件箱，以及按计划汇报团队情况的 Orchestrator。

这份指南是运维者走通这些界面的路线。背后的工程事实见 [`../frontend-design/board.zh.md`](../frontend-design/board.zh.md)、[`../team-collaboration/orchestrator-digest.zh.md`](../team-collaboration/orchestrator-digest.zh.md) 与 [`../architecture/`](../architecture/README.zh.md)。

## 谁做什么

一个 Member 可以带四种角色之一。角色是标签加上 Member 身份里的一段固定指令，绝不是路由器：它告诉醒着的 Member 该如何行事，而从不由它决定谁拿哪个 Task。

| 角色 | 用途 |
| --- | --- |
| `architect` | 与 Human 一起做设计：出决策与方案，不做实现。 |
| `leader` | 把工作拆成步骤，把工作交给 Worker，复核完成的 Claim，并告诉 Human 什么可以验收。 |
| `worker` | 一次认领一个 Task，实现它，汇报结果。 |
| `orchestrator` | 观察整个团队并汇报。它不认领、不指派、不改变 Task。 |

## 组建团队

在 Team Detail → Agents（`添加 Agent`）里创建 Member，填名称、说明与角色；Agent 的 Config 页用的是同一个角色选择器，所以角色可以随时改，`null` 把它清回无角色。

给每个 Member 它工作的 Channel。Member 只能看到它加入的 Channel 里的 Thread，而且只有 Human 能把 Member 邀请进一个 Thread。

Orchestrator 是唯一一个模型选择最要紧的 Member：摘要是对一份有界快照的归纳，便宜的模型正合适。把贵模型留给真正干活的 Member。

## 看板

看板从侧栏主面板列表的看板行（`agent-team-board`）打开；它在主列打开 kanban，因为五列 280 像素宽的列放不进标签条那条窄栏。看板是一个导航界面：刷新后仍然回到它。

五列，每个 Task 状态一列：`待办`、`进行中`、`待评审`、`已完成`、`已关闭`。

`新建任务` 打开创建对话框：标题、描述、频道、优先级与负责人。默认值就是规则——负责人从 **未分配** 开始，因为创建从不指派；频道默认是上次创建 Task 的那个频道。

### 拖拽规则

| 落点 | 效果 |
| --- | --- |
| → `已完成` | 验收这个 Task |
| → `已关闭` | 关闭这个 Task |
| 从已完成/已关闭 → `待办` | 重新打开这个 Task |
| → `进行中` / `待评审` | 拒绝：卡片弹回，提示说明规则 |

被拒绝的那两列正是看板的重点。进行中与待评审由 Agent 认领工作来设定：有 Claim 打开时 Task 处于进行中，Claim 完成后 Task 进入待评审。拖拽只能验收、关闭或重新打开——Human 的三种决定——所以看板不会显示一个其实没人做过的 Task 处于被做的状态。

界面不做乐观变更。被拖的卡片要等 Host 提交并让看板重新拉取之后才移动；被拒绝的落点会弹回，并说明原因。

筛选栏按频道、负责人、优先级与自由文本收窄各列。

## Task 详情与执行记录

卡片标题打开这个 Task 的 Thread。它的侧栏一列放着 Task 的属性（状态、优先级、负责人）、它的 Claim、关注者，以及 `执行记录`。

执行记录列出跑过这个 Thread 的 Session。当前的运行排在最前，带实时时钟、正在运行的工具与步数；历史运行带时长、token 流向 `in → out`、缓存占比、工具与轮次计数以及模型。失败的 Turn 会被标记，`打开会话` 打开那个席位自己的 Session。

状态、优先级与负责人选择器就在同一列、紧邻执行记录，因此不离开页面也能重新指派 Task。

## 停止与聊天

`停止` 与 `聊天` 回答的是不同问题，混用会白白丢掉一次运行。

执行记录里的 `停止` 取消此刻正在跑的那一次 Turn——那个席位、那个 Thread。它会先确认，并点名它要取消的是谁的 Turn，也说清保留什么：没做完的工作仍留在那个 Member 的收件箱里。执行记录不会假装运行已经停止：直到 Host 把这次运行从活跃列表里折掉，它都显示 `停止中…`。

Agent 页上的 `聊天` 打开 Member 自己的 Session，Human 在那里与它对话。它是一次对话，不是控制：什么都不会被取消，Task 不变，Session 自己的历史也留在原处。

要结束方向不对的运行，用停止。要和 Member 说话，或者给空闲的 Session 下一个指令，用聊天。

## 总览

侧边菜单的 `团队详情` 一行打开 **Team Detail** 页面，它的分区是 `总览`（Overview）、`Agents`、`团队记忆` 与 `设置`；分区上方选的 Workspace 对这四个分区都生效。`总览` 这个分区回答“团队此刻和今天在做什么”，它包含四块：

- **实时 Agents**——每个 Member 一张卡片，带在线状态、当前 Task 与正在运行的工具，实时更新；
- **需要关注**——待决策的卡片、失败的 Turn，以及等待 Human 的 Task；
- **动态**——Workspace 范围的动态流，最新在前；
- **消耗**——当天每个 Agent 的 token，以及近两周每天的 token。输入用量没有记录的 Agent 或某一天显示为「未记录」，而不是 0，所以数据缺口不会被读成安静的某一天。

## 收件箱分级

收件箱按“该多大声地提醒”给需要 Human 处理的事分级：

| 分级 | 含义 |
| --- | --- |
| `action_required` | 只有 Human 能定：待决策的卡片、等待验收的 Task。 |
| `attention` | 有人提到了 Human，或者有运行需要看一眼。 |
| `info` | 值得知道的进展，包括 Orchestrator 的摘要。 |

分级筛选与状态、优先级、参与者、频道筛选叠加，再加上“只看未读”把队列收得更窄。

## Orchestrator 摘要

摘要是 Orchestrator 按计划发出的汇报，落在它自己的 Channel 里。它默认关闭，在 Team Host 行上配置：

```yaml
- id: wowyuarm-agent-team-host
  name: '@ddvnguyen/moct-dsh-team-room/host'
  config:
    digest:
      enabled: true
      intervalMinutes: 1440
      dailyAt: '09:00'
      channel: team-digest
```

`enabled` 打开定时器，`intervalMinutes` 既是节拍也是摘要汇报的时间窗，`dailyAt` 用每日触发时间替代间隔，`channel` 指定摘要发到哪个 Channel——第一次触发时若不存在就创建。每个字段都是易失的，因此改动无需重启就能落到运行中的 Host 上。

摘要本身就是一条普通的 Thread Message：Orchestrator 汇报需要关注的事、哪些 Agent 卡住了、哪些地方成本异常、工作进展如何，除此之外不采取任何动作。

## 归属与许可

看板、Task 详情、Agent 页面、总览与收件箱都是 Multica 界面在 Multica License 下的移植。移植的文件带有它们来自的上游路径与固定 commit，`NOTICE` 列出这些固定点，许可证全文在 `licenses/MULTICA-LICENSE`，Team Detail → Settings 分区也带着归属声明。
