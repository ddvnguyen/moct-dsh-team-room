# 看板

[English](board.md) | 中文

看板（Board）是 Workspace 的 kanban：所选 Workspace 的全部 Task，每个 Task 状态一列，从侧栏标签条的 `看板` 标签打开（`Tasks | Board | Team | Agents | Scheduled`）。它是 Human 观察团队工作的地方——什么在排队、哪些 Agent 已认领、什么已完成——也是 Human 在 Agent 不会认领的状态之间移动 Task 的唯一界面。

页面实现在 `packages/client-agent-team/src/client/board/` 的 `TeamBoardPage`，是 Multica 看板视图在 Multica License 下的移植（见 [`multica-look.zh.md`](multica-look.zh.md)）。它复用的外观层、移植的纯函数与共享选择器都在那份文档里。

## 打开看板

`看板` 标签是客户端插入的原生标签（`team-tab.ts`，order 2）。它的标签体只是标签条自己的部分——一个 `打开看板` 动作——因为标签条在宿主较窄的侧栏里，五列 280px 的列在那里只能滚动。该动作选中 Team 导航当前持有的 Workspace（没有则取第一个），并把 Team 座位交给看板界面。

看板和 Inbox 一样是一个导航界面（持久化快照 `dsh.agent-team.navigation` 里的 `board: true`）：打开它会清掉 Channel/Thread 界面，刷新后仍回到看板，点开卡片则经由 Thread setter 离开看板。

## 列与卡片

五个固定列，每个 Task 状态一列（`todo`、`in_progress`、`in_review`、`done`、`closed`），由 Workspace 的 `view` 目录（`includeCatalog: true`）构建。

目录读取是一个 `TeamQueries` 条目，键为 `board:<workspaceId>`。Task 提交（创建、字段更新、认领、结案）只唤醒 Channel 与 Thread 作用域，从不唤醒 Workspace 作用域，因此页面和 Inbox 一样跟随无作用域的变更流；presence 唤醒不会触发重新拉取。

一张卡片展示：

- 优先级图标和 `#<taskNumber>`（左上）；
- 实时 Agent 活动指示（右上）：当 `memberActivity` 快照里有运行中的 Turn 归属于该 Task 的 Thread 时；
- 标题（看板之前创建的 Task 没有标题，显示 `#<taskNumber>`）；
- 频道胶囊与负责人头像；
- 正在运行的 Task 的 Claim 方向行。

长列用 `react-virtuoso` 虚拟化；每列的菜单提供 `隐藏列`，隐藏的列可从 `已隐藏的列` 栏恢复。隐藏列只是本浏览器里的界面偏好（localStorage 的 `dsh.agent-team.board.hiddenColumns`），不是数据事实。

## 新建 Task

`新建任务` 打开创建对话框，与其他 Team 对话框一样使用 dsh `Modal`（Esc 关闭）：标题、描述（纯文本域）、频道、优先级与负责人。默认值即规则：

- 负责人从 **未分配** 开始——创建从不指派；
- 频道默认为上次创建 Task 的频道（记在本浏览器的 `dsh.agent-team.board.lastChannel`），否则是第一个可见频道。

`创建` 调用 `createTask` Remote：一次提交在被选频道上同时产生未指派的 Task 和它的开头 Message，并排在 todo 列末尾。同一表单的重试沿用同一个 request id，丢失响应不会造成重复创建。提交后对话框关闭，目录重新拉取把新卡片送进 `todo`。

## 拖拽规则

拖拽使用 dnd-kit 的三种传感器：鼠标（5px 激活距离）、触摸（按住 250ms）与键盘（空格或回车拿起卡片，方向键移动，空格放下，Esc 取消），朗读文案使用界面语言。碰撞检测先 `pointerWithin` 再 `closestCenter`。规则就是协作模型的规则，在落点处执行：

| 落点 | 效果 |
| --- | --- |
| → `done` | `changeTask` 的 `accept` |
| → `closed` | `changeTask` 的 `close` |
| 从 `done`/`closed` → `todo` | `changeTask` 的 `reopen` |
| → `in_progress` / `in_review` | 拒绝：卡片弹回，提示说明规则（`进行中与待评审由 Agent 认领设定`）——这两个状态由 Agent 认领工作来设定，拖拽永远不能 |
| 同一列内 | `updateTask` 写入邻居之间的 `position`；邻居相等时（早于 position 间隔的 Task 都读作 0）整列重编为 1..n，只写编号变化的卡片 |

家规是 **不做乐观变更**：落点从不在本地移动数据。被拖的卡片进入结算状态（Remote 执行期间 `useDragSettle` 冻结镜像），只有 Remote 提交且变更唤醒重新拉取目录之后卡片才移动；被拒绝时卡片弹回并显示内联提示。

revision 过期（Task 已在别处变更）与 Thread 未读（Human 须先读新消息）都以普通 `ok` 结果返回，而不是错误，各有自己的提示；过期时还会重新拉取，使重试带上当前 revision。

每张卡片是一个 Tab 停靠点（带名称的分组）；标题是打开 Task 的 issue 的控件，优先级与负责人选择器是独立控件，不会打开它。

issue 是 Task 当前的界面（D10）。它取代的 Thread 界面是**旧版（legacy）**：已冻结，仍可从 Channel 界面进入，也可从 issue 头部的 *打开旧版 Thread 视图* 控件进入，读的是同一份 Host 事实——一份存储，两个视图。

## 筛选

筛选栏收窄各列显示的内容：频道、负责人（含 `未分配`）、优先级与自由文本，使用移植的 `multica/filter.ts` 与 `multica/sort.ts`。筛选是视图状态，不是持久化偏好；有筛选的空板显示空列，无筛选的空板显示整板空状态。

## 实时 Agent 活动

活动指示读取 `memberActivity` 快照（当前工具、步骤与工具计数、回合开始），经 `subscribeChanges` 在 `activity` 变更作用域上刷新，因此徽章在 Session 的 `session/event` 之后约一秒内出现。活动只是展示：它从不改变 Task 的状态——状态始终由 Host 从 Claim 推导。
