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

## 技能

Agent 的「技能」页管理它能加载的技能。列表是这个 Agent 的完整目录：插件自带的只读内置技能，加上这个 Agent 装进自己目录里的技能，每行都标明来自哪一边。

默认是**加载全部技能**，而且它说的是实话：以后新装的技能会自动加载。取消勾选一行会写成一份列出其余全部技能的显式选择，开关下面的提示就是这么说的——一份从不提及未来技能的选择正是陷阱。

保存从不乐观：Host 提交后页面会重新读一遍这个 Agent 的目录，所以勾选框显示的是存下来的，不是刚点的。选择在该 Agent 的下一个 turn 边界生效，同属一个 Session。

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

### 以 GitHub Issue 作为看板数据源

看板顶部的来源切换（`团队任务` | `GitHub`）让同一块看板改为从 GitHub 而不是 Team 账本取数。GitHub 就是存储：卡片是 Issue，列是所绑定 Project 的 `Status` 字段选项（没有绑定 Project 时是两个 Issue 状态），拖拽直接写 GitHub 上的这个字段。任何东西都不会镜像进账本，也没有乐观变更：重新读取把卡片放回新列之后，它才移动。`无状态` 桶放没有进入 Project 的 Issue，并且拒绝拖入，而不是悄悄清空字段。

卡片打开 Issue 面板——工作被讨论的地方。它带着描述、状态、标签与负责人，以及这个 Issue 的完整对话；在这里发表的评论直接写到 GitHub，面板重新读取之后评论才出现。`新建 Issue` 在 GitHub 上创建 Issue；绑定了 Project 时会放进第一个状态。

标签与负责人也在这里编辑。字段提供仓库自己的标签和可指派的人（随看板一起读取），所以选中的一定是 GitHub 认识的名称：点标签或负责人上的 `×` 移除，添加选择器只列出尚未附加的项。GitHub 会整体替换这两个字段，因此每次编辑都发送完整的新集合；写入被拒绝时，面板保持 GitHub 上的事实，并在界面上说明原因。

面板是可寻址的：打开的 Issue 就是 `?ghIssue=<编号>`，刷新后重新打开，链接也可以分享。这个参数属于 GitHub 看板自身，不会改动 Team 的查询参数。

配置属于部署，每次调用都从环境读取：

| 变量 | 含义 |
| --- | --- |
| `DSH_AGENT_TEAM_GITHUB_REPO` | `owner/repo`；必填 |
| `DSH_AGENT_TEAM_GITHUB_TOKEN` | 具有 Issue 读写权限的令牌；缺省时回退到 `GITHUB_TOKEN` |
| `DSH_AGENT_TEAM_GITHUB_PROJECT` | 可选：Projects v2 编号；它的 `Status` 字段成为看板的列 |
| `DSH_AGENT_TEAM_GITHUB_API` | 可选：GitHub Enterprise 实例的 API 地址 |

Project 可以挂在仓库上，也可以是仓库所有者名下的用户 Project 或组织 Project；这三种都能只凭编号找到。编号找不到任何 Project 时报出错误，而不是悄悄退回两个 Issue 状态。

只读一页——最近更新的 100 个 Issue、最早的 100 条评论——越过上限时会明确说明。没有配置仓库或令牌的部署显示配置说明，而不是一块空看板。

## Issue

卡片标题打开 Task 的 **issue**，而不是它的 Thread。issue 以浮层盖在读者所在的界面上——看板、收件箱，或被引用 Task 的 Thread——`最大化` 把它变成整列；`回到浮层` 放回去。

Esc 关闭并把焦点交还给读者来自的那张卡片，刷新后仍停在原处。URL 的 `issue` 查询参数写着这个 Task，复制链接即打开同一个 issue。

issue 是 Host 快照的一次读取，画成七个区域：头部（频道面包屑、`#n`、状态与内联标题编辑器）、描述、属性列（状态、优先级、负责人、创建时间与最后活动）、评论线程与输入框、动态、决策，以及执行记录。

Host 提交之前什么都不动：改名、评论或选择器都要等提交与变更到达，被拒绝的写入会弹回并说明原因。

决策区域是问题等 Human 回答的地方：席位提出的问题是一张卡片，带问题与推荐答案；已经做出的决策是一行，写明谁决定、决定了什么、为什么、何时。

席位提出的计划在 Human 批准后成为 issue 的描述，这次批准也是其中一行。两个工具记录在 [`../team-collaboration/tools.zh.md`](../team-collaboration/tools.zh.md)。

## 旧版 Thread

Thread 界面是**旧版（legacy）**（D10）。它没有被删除：issue 头部带 `打开旧版 Thread 视图`，Channel 界面仍然打开 Thread。

两个界面读的是同一份 Host 事实——在 issue 上写的评论就是 Thread 上的评论，从 issue 打开的 Thread 就是同一个 Thread。此后只接受修复：不加新区域、不加新写入。

## 执行记录

执行记录列出跑过这个 Thread 的 Session。当前的运行排在最前，带实时时钟、正在运行的工具与步数；历史运行带时长、token 流向 `in → out`、缓存占比、工具与轮次计数以及模型。失败的 Turn 会被标记，`打开会话` 打开那个席位自己的 Session。

状态、优先级与负责人选择器就在 issue 的属性列里，因此不离开 issue 也能重新指派 Task。

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
