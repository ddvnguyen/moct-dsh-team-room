# 上游同步

[English](upstream-sync.md) | 中文

本仓库 fork 自 [Contexera/dsh-agent-team](https://github.com/Contexera/dsh-agent-team)。上游改动用 `git cherry-pick -x` 分小批带过来，从不整体 merge。这里的 PR 是手工合并的，merge 不会留下共同历史；而且 fork 改动太多，一次 merge 无法评审。

## 同步状态

`scripts/upstream-sync.json` 是 fork 当前位置的唯一记录：

- `forkPoint`：两边共有的最后一个上游 commit。
- `lastReviewed` 与 `lastReviewedOn`：最近一次同步已做过决定的最新上游 commit，以及日期。
- `taken`：已带过来的每个上游 commit 及其批次；只带了一部分时附说明。
- `skipped`：未带的每个上游 commit 及原因。以后的同步可以重新评估原因。
- `renames`：本 fork 改过名的上游 package 名。
- `hotspots`：MOCT 改动最多的共享文件，那里的冲突最需要小心。

我们历史上的 `(cherry picked from commit …)` trailer 也算作已带入，但以 JSON 列表为准，因为手工合并可能丢掉 commit 正文。

## 报告

`node scripts/upstream-sync.mjs` 在缺少 `upstream` remote 时自动添加并 fetch，然后列出 `lastReviewed` 之后的每个上游 commit：

- `new`：尚未决定。`unrecorded`：比 `lastReviewed` 旧却不在任何列表里，说明 JSON 不完整。
- 每个文件标出 MOCT 的版本与 `lastReviewed` 相差多少行。数字大说明 pick 时那里会冲突。
- `renamed package name`：该 commit 提到了上游 package 名，import 行需要改名。
- 最后一节列出我们这边仍写着上游 package 名的文件。新文件应用时不会冲突，只有这里能发现它们。

`--all` 会包含已决定的 commit，`--ours <ref>` 比较另一个分支，`--no-fetch` 跳过 fetch，`--json` 输出机器可读结果。

## 流程

1. 运行报告，逐个阅读 `new` commit。按上游顺序把共享文件的 commit 分成批次，并对每个决定带入或跳过。
2. 从 `integration/test-4` 建分支，对第一批的每个 commit 运行 `git cherry-pick -x <commit>`。后续批次各自建在前一批的分支上，各开一个 draft PR。
3. 解决冲突时保留 MOCT 的实现，再落实上游的意图。保留我们的 `CHANGELOG.md`，改名上游 package 的 import，并用 `git status` 检查编辑器是否悄悄解决了 modify/delete 冲突。
4. 每一批都运行 `npm run build`、`node scripts/sync-paths.mjs`、`npm run typecheck`、`npm test`、`npm run check:docs` 和 `npm run lint`。测试按 package 名引用 bundle，所以必须先 build。改动可见 UI 的批次还需要 `npm run test:browser`。
5. 重新运行报告：仍写着上游 package 名的文件列表必须为空。
6. 在最后一批的 PR 里，把 `lastReviewed` 与 `lastReviewedOn` 往前推，并把每个已决定的 commit 加入 `taken` 或 `skipped`。

## MOCT 独有区域

这些区域只存在于本 fork，上游从不触碰，因此紧挨着它们的冲突一律保留我们的版本：

- MOCT 存储：`moct-table.ts` 和 `MOCT_TEAM_URL` 路由。
- Member 记忆：`team-memory*.ts`、`seat-memory.ts`、`memory-tools.ts` 以及记忆面板。
- Team Documents：`team-docs.ts`、`doc-tools.ts` 以及 `TeamDoc*` 组件。
- 多实例 seat：`member-instances.ts`、`instance-router.ts`、`warm-limit.ts`，以及 Host 里的 `slotHandles` 路径。
- Turn 记录与摘要：`turn-recorder.ts`、`turn-threads.ts`、`thread-summary*.ts`、`session-turn-usage.ts`。
- 双栏视图（`TeamLanes.tsx`、`lane-width.ts`）、Agent 详情与设置页，以及 composer 的 agent 选择器。
- `scripts/migration/` 与 `@ddvnguyen/moct-dsh-team-room` package 名。

报告会把这些文件都计为只存在于本仓库。

## 已知陷阱

- 上游一个系列的中间 commit 可能是红的。2026-10-16 时，`4c9dae7` 和 `5ff1e8a` 让两个测试一直失败，直到 `9a29b27` 和 `3a8865d` 才修好。每一批都要跑测试，并把后面的修复提前带进这一批。
- 上游把 mention 开放给整个 Workspace。MOCT 的 agent 选择器仍限于 Channel 或 Thread 的名单，因此选一个 agent 不会把陌生人拉进来。
- 有多个实例的 seat 共用一个 Member id，所以来自上游的按 Member 探测必须同时读取 `slotHandles` 和 `handles`。
