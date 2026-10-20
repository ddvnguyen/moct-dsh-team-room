# Orchestrator 与它的定时摘要

[English](orchestrator-digest.md) | 中文

Orchestrator 是 `role` 为 `orchestrator` 的 Member。它观察整个 Workspace 并做汇报，从不采取行动。本页拥有定时摘要这件事：Orchestrator 能做什么、调度如何配置、摘要落在哪里。

## Orchestrator 角色

`addMember` 与 `updateMember` 设置 Member 的 `role`，`orchestrator` 是四个角色之一。角色是一个标签，加上 Member 身份块里固定的一段提示——永远不是路由规则：未分配的任务保持未分配，Orchestrator 不会认领。

Orchestrator 的职责是总结它看到的情况。它通过面向模型的工具阅读，在 Thread 里发言，并通过 mention 询问 Human。普通 Member 的一切仍然适用：它拥有自己的 Session、自己的记忆和自己的上下文。

## Orchestrator 不能做的事

Orchestrator 的工具面是普通 Team 工具面减去 `team_claim`：角色在限制接缝处把它扣掉，因此这个工具不是调用时被拒绝，而是根本不出现在 Orchestrator 的请求里。早于该角色就已存在的工具面同样会拒绝这次调用；对 Orchestrator 而言，带 `asTask` 的 `team_message` 一律被拒绝。

剩下的就是一个只汇报的 Member：它可以读、可以发消息、可以提问、可以回答，但不能改变任务状态、不能持有 Direction Claim、也不能指挥其他 Member。

## 摘要调度

摘要跑在 Host 侧计时器上，而不是 Harness 的 schedule 服务：schedule 提醒绑定一个 Session id，而 Member 的 Session 会在 rollover 与续期时改变。Host 在每个 tick 上重新解析当前在席的 Member。

调度配置在 Team Host 行的 `digest` 段里。每个字段都是 volatile 的，因此启用、停用或改期都能落到正在运行的 Host 上，无需重启。

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `enabled` | 摘要调度器是否运行 | `false` |
| `intervalMinutes` | 两个 tick 之间的分钟数；同时也是摘要所报告的窗口 | `1440` |
| `dailyAt` | 可选的每日触发时刻 `HH:MM`（Host 本地时间）；设置后取代间隔作为触发时间 | 未设置 |
| `channel` | 摘要发布到的 Channel 名称；缺失时创建 | `team-digest` |

部署方在 profile 的 patch 层里给 Host 行设置它们：

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

`intervalMinutes` 同时也是报告窗口：提示要求 Orchestrator 取最近 N 分钟，所以每日摘要报告一天，每小时摘要报告一小时。

## 摘要 Channel

第一个 tick 会在摘要 Channel 缺失时创建它，并把该 Workspace 中已启用的 Member 作为成员。名称取自 `channel` 字段，默认是 `team-digest`，部署方可以另选。这个 Channel 只创建一次：之后的 tick 复用它，同名的既有 Channel 会被沿用而不是重复创建。

摘要就是该 Channel 里一条普通的 Thread 消息，因此 Human 在阅读其他所有 Team 消息的同一个地方读到它。

## 摘要汇报什么

每个 tick 用一条指令唤醒 Orchestrator：对窗口调用 `team_activity`，然后发布一条摘要消息，涵盖需要 Human 处理的事、哪些 agent 卡住或空转、成本异常在哪里，以及工作进展如何。这条指令只要求汇报——不认领、不分派、不改变任务状态。

只有空闲时才会唤醒 Orchestrator。忙碌的 Member 会被跳过，由下一个 tick 补上，因为摘要绝不能去打断正在运行的 turn。

`team_activity` 是摘要背后的只读快照：逐 agent 的状态、当前任务、空闲分钟数、窗口内的 turn 数、token 与失败 turn、按状态归类并带年龄的任务、待决的决策卡，以及窗口内最靠前的事件。它自己的输出有界，并明确标出每一次截断。

## 预算

Orchestrator 的模型来自它自己的 Member `model` 选择。摘要是在一个有界快照上做总结，因此便宜模型才是合适的；把昂贵模型留给真正做活的 Member。提示、窗口和 Channel 就是摘要的全部成本：每个 tick 一个 turn。
