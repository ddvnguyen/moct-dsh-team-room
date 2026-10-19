# codex-ui 侧栏补丁

[English](codex-ui-sidebar-patch.md) | 中文

## 为什么需要补丁

`@michengai/dsh-codex-ui` 渲染 Team Room 所在的侧栏。其中两项需求无法通过它的公开 slot 表达：

- **页签条里的插件页签。** 页签条（`Tasks | Channels | Schedule`）没有公开的注册 API。automation 插件持有一个私有注册表（`__dshNativeTabs`），Team Room 已经用它发布自己的 `Teams` 页签。
- **紧挨 "New task" 的面板。** 自 codex-ui 1.1.39 起，所有插件面板都渲染在 Extensions 分组内，`Context Insights` 与 `Team Settings` 无法再留在顶层。

补丁把这两项能力加进已发布的 codex-ui 包。补丁只提供机制，策略仍由本仓库决定。

## 补丁加了什么

只有两个接缝：

- `__dshNativeTabs` —— 原生页签注册表，即 automation 插件已经在用的契约。Team Room 的 `Teams` 页签通过它渲染在页签条里。
- `__dshTopPanels` —— 渲染在 "New task" 旁、而不是 Extensions 内的面板 id 列表。

补丁通过带锚点的编辑（`scripts/codex-ui-sidebar-patch/edits.mjs`）应用，而不是基于行号的 diff。锚点未变的 codex-ui 版本无需新补丁；锚点被移动的版本会让应用器报出失配的编辑 id，并且不改动已安装的包。

## 策略归谁

`@ddvnguyen/dsh-side-menu` 通过 `globalThis.__dshTopPanels` 发布顶层面板 id（`dsh-context`、`agent-team-settings`），并用 CSS `order` 排列菜单子项。没有补丁时该发布不产生任何效果，主机保持自己的布局；该插件从不把 React 拥有的节点搬出菜单。

## 如何应用与保持应用

`scripts/codex-ui-sidebar-patch/apply.mjs` 就地修补已安装的 codex-ui，幂等，把原件留在补丁文件旁边，并在写入前做语法检查。`deploy-dsh-x-sidebar.sh` 跑完整的 dsh-x 流程：profile 版本、安装、补丁、重启。

dsh-x profile 带有一个 `postinstall` 钩子，每次 profile 安装后都会运行应用器，因此 `dsh plugin update @michengai/dsh-codex-ui` 会重新打上补丁，而不是悄悄丢掉 `Teams` 页签。

## codex-ui 发版时检查什么

1. `node scripts/codex-ui-sidebar-patch/apply.mjs <codex-ui-dir> --check` —— 补丁仍然适用。
2. 若不适用，读报错给出的编辑 id，找到上游的新形态并调整锚点。不要重写功能：编辑列表就是功能本身。
3. `node scripts/codex-ui-sidebar-patch/generate.mjs <version>` 生成该版本可审阅的 diff。
