# Multica 外观层

[English](multica-look.md) | 中文

团队看板、Task 详情、Agent 页面、Overview 与 Inbox 沿用 Multica 的信息密度和
视觉节奏，但不复用它的渲染栈。Multica 使用 Tailwind + React 19 + i18next；
本客户端使用 CSS Modules + React 18 + `locales.ts`。两者由一个作用域变量层衔接。

## 位置

`packages/client-agent-team/src/client/multica-look.module.css` 导出
`multicaLook` 作用域类。每个移植组件的根节点都包在该类中，并且只读取
`--ml-*` 变量。

```tsx
import look from '../multica-look.module.css'
import css from './BoardCard.module.css'

<div className={`${look.multicaLook} ${css.card}`}>…</div>
```

移植的纯函数（状态、优先级、拖拽、排序、过滤、在线状态、收件箱过滤、
相对时间）位于 `src/client/multica/`，不依赖 DOM，因此可以在 node 环境的
测试中直接覆盖。

## 共享组件

`src/client/multica-ui/` 存放所有页面复用的展示组件。每个文件保留 Multica 来源头；
每个组件只通过 props 接收数据，并通过回调上报变更。

| 组件 | Multica 来源 | 差异 |
| --- | --- | --- |
| `StatusIcon` | `views/issues/components/status-icon.tsx` | 仅五种派生状态；没有自定义颜色/图标目录 |
| `StatusHeading` | `views/issues/components/status-heading.tsx` | 标签来自 `locales.ts`；不接 workspace 状态 hook |
| `PriorityIcon` | `views/issues/components/priority-icon.tsx` | 色调走 `--ml-priority-*` 类 |
| `ProgressRing` | `views/issues/components/progress-ring.tsx` | 完成态走 `--ml-status-done` |
| `ActorAvatar` | `views/common/actor-avatar.tsx` + `ui/components/common/actor-avatar.tsx` | 名称/URL/类型均为 props；无悬浮卡与个人页链接 |
| `AgentAvatarStack` | `views/agents/components/agent-avatar-stack.tsx` | 名册切片作为 props；保留 `+N` 溢出 |
| `AgentPresenceDot` | `views/agents/components/agent-presence-indicator.tsx` | 派生结果作为 prop；加载中是中性圆点 |
| `AgentActivityIndicator` | `views/issues/components/issue-agent-activity-indicator.tsx` + `agents/components/agent-activity-hover-content.tsx` | `memberActivity` 快照作为 props；使用带 `inline` 的 dsh `HoverCard`，键盘聚焦即打开逐 Turn 详情，触屏用户可直接读到徽标上的工具与步数 |
| `StatusPicker` | `views/issues/components/pickers/status-picker.tsx` | 五种状态；仅待办/已完成/已关闭可选 |
| `PriorityPicker` | `views/issues/components/pickers/priority-picker.tsx` | 保留展示顺序；无延迟挂载 |
| `AssigneePicker` | `views/issues/components/pickers/assignee-picker.tsx` + `property-picker.tsx` | 仅成员；「未分配」写入 null；无 squad |
| `PickerMenu` / `PickerItem` | `views/issues/components/pickers/property-picker.tsx` | 外部点击、Escape 与焦点返回交给 dsh `Menu`；列表使用 portal，触发器名称为“字段：值”，触发器会拦截自身点击，避免点击卡片时打开卡片 |

一致性审计（`node scripts/audit-ui-parity.mjs`）会递归子目录，因此 `multica-ui/`
下的样式表与顶层样式表适用同一套焦点、token 与几何规则。

## Token 映射

存在等价项时，`--ml-*` 映射到宿主的 `--dsw-*` 别名，深色模式随宿主自动切换。
字面量回退值是 Multica 的浅色取值，仅在宿主未定义该别名时生效。

| `--ml-*` | 宿主别名 | 回退值 |
| --- | --- | --- |
| `--ml-text-micro` … `--ml-text-display` | 无（字号阶梯） | 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 36px |
| `--ml-radius-xs` … `--ml-radius-2xl` | 无（宿主没有对应的圆角阶梯） | 3 / 4 / 6 / 8 / 12 / 16px |
| `--ml-surface` | `--dsw-alias-bg-layer-1` | `#ffffff` |
| `--ml-surface-raised` | `--dsw-alias-bg-layer-2` | `#f7f7f8` |
| `--ml-surface-hover` | `--dsw-alias-interactive-bg-hover` | `rgb(0 0 0 / 4%)` |
| `--ml-border` | `--dsw-alias-border-l2` | `#e5e5e7` |
| `--ml-text` | `--dsw-alias-label-primary` | `#18181b` |
| `--ml-text-secondary` | `--dsw-alias-label-secondary` | `#52525b` |
| `--ml-text-tertiary` | `--dsw-alias-label-tertiary` | `#71717a` |
| `--ml-text-faint` | `--dsw-alias-label-caption` | `#a1a1aa` |
| `--ml-brand` | `--dsw-alias-brand-primary` | `#4d6bfe` |
| `--ml-status-in-progress` | `--dsw-alias-state-warn-primary` | `#d97706` |
| `--ml-status-in-review` | `--dsw-alias-state-success-primary` | `#059669` |
| `--ml-status-done` | `--dsw-alias-brand-primary` | `#4d6bfe` |
| `--ml-priority-urgent` | `--dsw-alias-state-error-primary` | `#dc2626` |
| `--ml-presence-*` | success / warn / caption / brand | 同上 |

密度常量（`--ml-card-padding`、`--ml-column-width`、`--ml-row-height`）没有宿主
等价项，作为有文档记录的字面量保留。

## 规则

- 移植文件保留来源头：上游路径、锁定的 `multica-x` 提交与版权行。与 Multica
  重新同步时更新头中的提交并重读差异，不做静默修改。
- Tailwind 类名列表改写为基于 `--ml-*` 的模块规则。不要引入工具类框架或
  PostCSS 步骤：`scripts/build-client.mjs` 没有该步骤。
- `@multica/ui` 原语替换为 `@deepseek-ai/dsh-client-ui-primitives`；Multica 图标
  改为内联 SVG（保留来源头），或使用宿主已有图标。
- 数据只通过 props 传入，移植组件不接触 `ctx`。
- React 18：需要 ref 的移植组件使用 `forwardRef`；`use(Context)` 改为
  `useContext`。

## 署名

`NOTICE`、`licenses/MULTICA-LICENSE` 以及团队设置 → 关于中的一行承载 Multica
License 署名。仅限内部使用；对第三方提供托管服务需要 Index Labs 的商业许可。
