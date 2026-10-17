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

## Token 映射

存在等价项时，`--ml-*` 映射到宿主的 `--dsw-*` 别名，深色模式随宿主自动切换。
字面量回退值是 Multica 的浅色取值，仅在宿主未定义该别名时生效。

| `--ml-*` | 宿主别名 | 回退值 |
| --- | --- | --- |
| `--ml-text-micro` … `--ml-text-display` | 无（字号阶梯） | 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 36px |
| `--ml-radius-xs` … `--ml-radius-2xl` | 基础档使用 `--dsw-radius-md` | 3 / 4 / 6 / 8 / 12 / 16px |
| `--ml-surface` | `--dsw-alias-bg-layer-1` | `#ffffff` |
| `--ml-surface-raised` | `--dsw-alias-bg-layer-2` | `#f7f7f8` |
| `--ml-surface-hover` | `--dsw-alias-interactive-bg-hover` | `rgb(0 0 0 / 4%)` |
| `--ml-border` | `--dsw-alias-border-l2` | `#e5e5e7` |
| `--ml-text` | `--dsw-alias-label-primary` | `#18181b` |
| `--ml-text-secondary` | `--dsw-alias-label-secondary` | `#52525b` |
| `--ml-text-tertiary` | `--dsw-alias-label-tertiary` | `#71717a` |
| `--ml-text-faint` | `--dsw-alias-label-quaternary` | `#a1a1aa` |
| `--ml-brand` | `--dsw-alias-brand-primary` | `#4d6bfe` |
| `--ml-status-in-progress` | `--dsw-alias-state-warn-primary` | `#d97706` |
| `--ml-status-in-review` | `--dsw-alias-state-success-primary` | `#059669` |
| `--ml-status-done` | `--dsw-alias-brand-primary` | `#4d6bfe` |
| `--ml-priority-urgent` | `--dsw-alias-state-error-primary` | `#dc2626` |
| `--ml-presence-*` | success / warn / quaternary / brand | 同上 |

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
