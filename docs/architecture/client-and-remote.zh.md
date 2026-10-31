# Typed Remote 与 Client 边界

[English](client-and-remote.md) | 中文

## Typed Remote
Remote methods 通过 Team service 的 `@Remote` annotations 声明。`scripts/generate-typert.mjs` 使用 Harness `WorkspaceAnalyzer` 和 `FaceModelEmitter`，在 `packages/agent-team/lib/` 下生成 Host 和 Client artifacts。

稳定流程如下：

```text
Host face declaration
        │ generate:typert
        ▼
Typert Host artifact + Remote client artifact
        │ ctx.remote.$mount(...)
        ▼
Client remote service
```

`InvocationDescriptor` 是 local reflection metadata，不是 wire message。Wire request 和 response fields 保持为显式 typed values。修改 Remote 时更新 declaration 和 tests。重新生成，然后运行 typecheck/build。不要手工编辑 artifact。

读取请求各自声明用途，不共用一种投影形状。只有当调用方要整个请求 scope 的 Task/Thread/Claim catalog（模型侧 `team_view` 渲染的 address book）时才传 `includeCatalog`；Client 的读取从不传它，只渲染自己请求的那一页。

有一个读取完全不需要 Channel：`workspaceActivity` 把一个 Workspace 下的所有 Channel 折成一页——总量、各 seat 的份额、Session runs、最新在前的动态 feed，以及按天的消耗桶。因此 Workspace 在任何 Channel 存在之前就能作答。空 Workspace 是合法的空聚合，不是错误。

## Remote failure vocabulary
生成的 Remote methods resolve 为 `RemoteResult`。`{ ok: true, value }` 携带业务结果，`{ ok: false, error }` 携带失败：稳定的 `code` 是判别字段，`details` 随 `code` 收窄，无需 cast。

- 业务拒绝（`unread_required`、`stale_revision`、`confirmation_required`）保持 result union。它们是 Client 已经建模的正常控制流，不是 Remote error。
- 需要 Client 独立分支的预期跨 Remote 失败以 `RemoteError` 抛出。owner 通过向 `RemoteErrorDetailsMap` merge 声明自己的 code。Team 把 codes merge 进两个 face 共同编译的公开 types 入口。Team 的第一个 code 是 `team/attachment-not-found`。attachment read 把已消失的 cache entry 与其他一切失败分开。
- Client 按 `code` 分支，绝不解析 message 文本。message 只是人类诊断，不是契约。未知 code 与未分类的 Host 异常以 `gateway/internal` 到达，因此每个分支都保留通用 fallback。attachment preview 把 not-found 结算为过期 chip。其它失败一律不缓存，下一次渲染重试 Host。

## Client plugin 和 slot composition
Team browser plugin 是 external Client plugin。Shipped Shell 继续拥有 outer layout。Team 增加一个 additive footer action，并动态 shadow 三个 seats：

```text
sidebar.panellist           additive Team row, order 20
main (key agent-team)       Team panel, priority -100
sidebar.workspaces          Team shadow, priority -100
main (key conversation)     Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

Browser activation 顺序是：

```text
Client plugin apply
  → ctx.remote.$mount(agentTeamRemote)
  → ctx.inject(['remote.agentTeam'], ...)
  → register Team panel, rail row, and mode shadows
```

`dsh.client.inject` 描述 client module graph；它不保证 apply order、service readiness 或 slot declaration order。如果 declaration 可能稍后出现，使用 `ctx.slots.inject()`。registration 跟随 declaration lifetime，并随 owning fiber disposal。

panel row 与 Team mode 是同一件事：这一行是 shell 自己的 rail button，选中它即进入 mode，另一个 panel 拿走中栏即离开 mode。selection 为 null 时 Team 不介入——嵌入的 Member Session 视图会清空 panel 来独占中栏，mode 必须活过这一段——离开 mode 由 mode 自己的 foot row 清空 panel。恢复的 mode 会重新选中自己的 panel，除非挂载时已有 panel 被选中：那时那个 panel 保留中栏，mode 主动让位。

Overview、Team 与 Agents 三个 tab 位于侧栏的 tab strip。strip 没有公开的注册 API：strip 的所有者把私有的 `__dshNativeTabs` registry 挂在它的 `sidebar.workspaces` component 上，`team-tab.ts` 向其中 insert；找不到 registry 时静默退出，保留 rail 行。

目前有两个宿主拥有 strip。官方侧栏加 `@michengai/dsh-automation` 会挂 registry。`@michengai/dsh-codex-ui` 替换官方侧栏，使 automation 退出，且在 1.1.33 不挂任何 registry，所以这两个 tab 需要 codex-ui 自己承载 registry（同一个 key、同一个挂载点、同一个 `{ id, label, order, matchSession, render }` descriptor）。

Team 不为此注册第二个 `sidebar.workspaces` entry：codex-ui 的 patch 警告重复的 child slot 会使其激活失败。

Slot parent 的 `children` declaration 同时是 render site 和 render authority。两个存活的 parent entries 不能声明同一个 child slot。特别是 Team 的 `sidebar.workspaces` shadow 不得重新声明 shipped `sidebar.workspaces.directoryFlow`。即使 Team entry priority 更高，Harness SlotCore 也会拒绝这个 duplicate。不要复制 private WorkspaceBrowser、ConversationRoot、Shell 或 private CSS 来规避它。

Team feature 需要现有 Harness capability 时，使用 public service 或 package export。对于 directory selection，先检查 `ctx.workspaces.pickDirectory()` 和 `host.pickDirectory` path，再考虑 Team-specific picker。如果 public contract 无法表达目标 composition，就记录这个 limitation。选择 Team-owned plugin 或新设计。不要静默依赖 private implementation details。

## Client data 和 presentation boundary
`packages/client-agent-team/src/client/` 下的 components 不接触 `ctx`、operation ledger 或 Host classes。Data 与 callbacks 通过 Client slot contract 进入，包括 owner props、runtime props、declared store 或 inject face。Presentation layer 只消费 Host projections 和本地 navigation state。它不自行发明 durable facts。

UI work 的边界如下：

- Channel composer 默认创建 taskless Thread。它提供默认关闭的「作为任务」控件，以原子创建 Task。 taskless Thread 保留 normal read/reply/inbox behavior。promotion 之前隐藏 Task status、Claims 和 Task-resolution controls。 Promotion 是 durable、non-optimistic 的 Host mutation。成功后 Client 重新读取 Thread 和 supplemental projections。它不在本地合成 Task。

  Human Client 消费 Host 的 Inbox 投影，但绝不维护并行 Inbox authority。投影有两片。第一片是「收件箱 / Inbox」队列：合并各 Workspace 的徽标与页，覆盖读者的整片未读。mention 只在其中计数，绝不是准入条件。第二片是该读者写过 Message 的「最近活跃」段。回复过的 Thread 无论是否 follow 都算他的。按最新活跃降序，Host 侧每个 Workspace 上限 10，合并到页面上最多 5 条。第二片永不进入 agent 的 Inbox。打开页不确认任何内容。

  Thread reads 使用 Host projections（`readThread`、`threadHistory`）和 Host mutations（replies、promotion、Task actions）。 当前 Thread UI 不提供 Attention controls 或 observations。这些 controls 的 Host Remote methods 留给后续自有 UI。 Browser 会持久化五样东西。Team navigation mode、Workspace selection、最近选中的 Channel 或 Thread、Inbox 页位置，还有 Overview 页。回到 Team 时恢复位置。unread 或 Attention 不持久化。Overview 页与 Channel 页一样以 Workspace 为范围：选中 Workspace 或 Channel 即离开它，页面数据始终实时读取。

  issue 界面有**同一棵树上的两种呈现**：占满整列的页面，以及浮在当前界面之上的 slice 浮层。slice 只有一个宿主——挂在 shell 的浮层层里——所以底下的界面仍然活着、仍然可交互；它读的是和页面同一个 `issueView` 值，**最大化**在不改变位置的情况下在两者之间切换。窄视口下 slice 退化为页面。打开它只有一个入口——`openIssue(taskRef)`——看板、收件箱、Thread 里被引用的 Task、seat 的 Task 都走它；slice 不新增任何导航标志：`issueRef` / `issueVariant` 那个槽是位置的，slice 是浮层而不是位置。

这个入口和它旁边的那个 context 一共带三件槽里没有的事：**issue 读取的那个 Workspace**、**焦点要回到的那个控件**，以及**底下的界面为面板键盘行走发布的顺序**。收件箱合并了所有可见的 Workspace，所以某一行可能属于读者没有选中的那个 Workspace——选它就会离开收件箱，而那正是 slice 要浮在上面的界面——所以 issue 在该行自己的 Workspace 里读取。焦点回到读者按下的那个控件，而且它以「聚焦它的方法」而不是「一个节点」的形式记录：看板目录一变，卡片就会重绘，等到读者关闭 issue 时，记下的节点已经过期。slice 是瞬时的，页面是位置：只有页面会被持久化，所以刷新永远不会凭空打开一个没人要求过的对话框。

面板行走这份顺序：`J`/`K` 走到它的下一个/上一个 issue，`H`/`L` 在它的列之间移动（空列会被跳过），方向键是它们的镜像——但读者在面板内时方向键归滚动条所有，所以窗格自己照常滚动。这份顺序是界面自己的事实，发布在 issue client 里、与 context 并列——看板为每个可行走列发布一列（折叠列从不进这份顺序），收件箱按读者看到的顺序发布它的队列——面板从不为它去读导航：不发布的界面就没有行走。每一步都带着焦点要回到的那个控件，所以走一步之后按 Escape，焦点回到读者正站着的那张卡片或那一行。

  Issue 界面是与这些 face 正交的一个 slot，不是新的 face：snapshot 里记着当前打开的 issue 所属的 Task 以及它的呈现方式（整列的页面，或浮在当前 face 之上的对话框），底下的 face 原地不动，关闭 issue 就回到原处。issue 的内容是 Host 的 `issueView` 快照——每个 issue 一次读取，不带 variant——client 渲染它携带的六个 region；呈现方式是 client 的事，永远不是读模型上的字段。

  时间线是一个合并后的列表。合并是 client 的纯函数，输入是 Host 的评论页、动态区与 Session runs，以每一行自带的时刻为键，因此边界仍归 Host，顺序不由 client 发明。

  浏览器自己的后退/前进按钮会走过这些位置。Team 在导航快照之上维护一个历史栈：每次导航压入一个 `pushState` 条目——路径永远是文档自己的，只带一个 state 对象，URL 也不掺进路由这件事——而 `popstate` 是位置唯一的回放路径，所以浏览器按钮和座位自己的后退控件不会各走各的。

  这个栈存的是位置，不是渲染出来的视图：界面标志、引用，以及带变体的问题槽。只有「读者在哪」变了才产生条目——筛选、选择器、折叠和行内编辑都不是位置——栈上限 32 条，超出丢最旧的一条，刷新后仍在。

  关闭问题会消费掉它打开时压入的那一条，所以浏览器后退是合上浮层而不是从它底下走开。浮层本身是瞬态的：刷新只恢复界面，不恢复浮层。

  URL 的 query 是插件自己的状态，它带着 issue：`issue` 指出 Task，`variant` 指出呈现方式，所以复制出去的链接能打开那个 issue。query 每次导航都从当前位置写出，它只是 query 的相对 URL，路径永远不变。

  冷启动读 query，用 `page` 变体打开 issue——浮层是瞬态的，冷启动也没有可以归还焦点的开合动作。挂载路径和 base 都不会被碰到，URL 上别的参数也不归 Team 管。

  Agent Inbox 仍由 Host 持有，并通过 `team_inbox` 提供。
- Sidebar row order（Channels/Agents）是每个 browser 的 Human presentation preference，保存在 `localStorage`。加载时折叠到 Remote default order 上。保留的 refs 保持顺序，移除的 refs 丢弃，新的 refs 追加。它从不成为 ledger fact。Whole-row native drag 复用 Harness list interaction model。它是 Team-owned rows 唯一的重排控件。
- 嵌入的 Team Member Session 使用未修改的 shipped composer。Team 不注册任何成员会话的 composer 表面。它不接管 seat，没有 trigger sources，没有 dock 提示条。rc.1 把 trigger-menu overlay 移进了 `conversation.composer.bar` 的 children。接管者会一并继承渲染义务，并使 overlay 悬空。Team 自有的命令/成员引用入口相对 shipped 词汇表不再有不可替代的价值，因此一并移除。普通会话与 Member Session 共享同一 composer 与词汇表。
- 有对应能力时复用 public Harness primitives 和 `--dsw-*` theme tokens。
- CSS 保持在 CSS Modules 中；不要 import private Harness CSS。
- Runtime presence 必须与 Claim 和 Task state 分离。
- Task resolution controls 会修改 Task 和 Claim。Closed Task 对 replies 和 new Attention 是 terminal。reopen 会恢复 open Task，但不会恢复此前的 Attention。
- Message、Activity、Claim 和 Task 的 presentation 要保持区分且用户可读。不要暴露 opaque refs 或 internal enums。
- Durable mutations 不做 optimistic update。失败时保留 input，并渲染下一份 Host projection。
- 保持 Team mode enter/leave、refresh recovery、slot restoration 和 narrow layout behavior。
- issue 的评论区域读契约的 `comments` 区域，用同一条 history 读分页 Thread 页读的同一批事实：一个 store，两个视图。分页只有一处调用——issue page 的那次——并且写明了自己的 limit（`limit: 20`，在 Host 的 1–100 边界内）。决策区域拥有那条 ask 消息，评论区域跳过它；回复挂在其父级下一层，因为 ledger 每条消息只记一个父级。编辑评论、resolve 与 reactions 不在本批：ledger 是 append-only。

UI redesign 已完成。需要理解当时的取舍时，查 [`.scratch/archive/2026-08/ui-redesign/`](../../.scratch/archive/2026-08/ui-redesign/)。它是历史设计背景，不是当前实现权威。UI 改动的当前验收规则见 [`development/README.zh.md`](../development/README.zh.md)。
