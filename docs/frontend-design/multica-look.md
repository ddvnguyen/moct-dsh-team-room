# Multica look layer

English | [中文](multica-look.zh.md)

The Team Board, Task detail, Agent pages, Overview and Inbox reuse Multica's
information density and visual rhythm without reusing its rendering stack.
Multica is Tailwind + React 19 + i18next; this client is CSS Modules + React 18
+ `locales.ts`. One scoped variable layer bridges the two.

## Where it lives

`packages/client-agent-team/src/client/multica-look.module.css` exports the
`multicaLook` scope class. Every ported component wraps its root in that class
and reads `--ml-*` variables only.

```tsx
import look from '../multica-look.module.css'
import css from './BoardCard.module.css'

<div className={`${look.multicaLook} ${css.card}`}>…</div>
```

Ported helpers (status, priority, drag, sort, filter, presence, inbox filter,
time-ago) live in `src/client/multica/` and are DOM-free, so node-environment
specs can cover them.

## Shared components

`src/client/multica-ui/` holds the presentation every page reuses. Each file
keeps the Multica derivation header; each component takes data through props
and reports a change through a callback.

| Component | Multica origin | What changed |
| --- | --- | --- |
| `StatusIcon` | `views/issues/components/status-icon.tsx` | five derived statuses; no custom color/icon catalog |
| `StatusHeading` | `views/issues/components/status-heading.tsx` | label from `locales.ts`; no workspace status hook |
| `PriorityIcon` | `views/issues/components/priority-icon.tsx` | tone through `--ml-priority-*` classes |
| `ProgressRing` | `views/issues/components/progress-ring.tsx` | complete tone through `--ml-status-done` |
| `ActorAvatar` | `views/common/actor-avatar.tsx` + `ui/components/common/actor-avatar.tsx` | name/URL/kind props; no hover card or profile link |
| `AgentAvatarStack` | `views/agents/components/agent-avatar-stack.tsx` | roster slice as props; `+N` overflow kept |
| `AgentPresenceDot` | `views/agents/components/agent-presence-indicator.tsx` | derived detail as a prop; neutral dot while loading |
| `AgentActivityIndicator` | `views/issues/components/issue-agent-activity-indicator.tsx` + `agents/components/agent-activity-hover-content.tsx` | `memberActivity` snapshot as props; dsh `HoverCard` |
| `StatusPicker` | `views/issues/components/pickers/status-picker.tsx` | five statuses; only todo/done/closed enabled |
| `PriorityPicker` | `views/issues/components/pickers/priority-picker.tsx` | display order kept; no deferred popup |
| `AssigneePicker` | `views/issues/components/pickers/assignee-picker.tsx` + `property-picker.tsx` | members only; "Unassigned" writes null; no squads |
| `PickerMenu` / `PickerItem` | `views/issues/components/pickers/property-picker.tsx` | dsh `Menu` owns outside-click, Escape and focus return |

The parity audit (`node scripts/audit-ui-parity.mjs`) walks subdirectories, so a
sheet under `multica-ui/` follows the same focus, token and geometry rules as
the top-level sheets.

## Token map

`--ml-*` maps onto the host's `--dsw-*` aliases wherever an equivalent exists,
so dark mode follows the host automatically. The literal fallback is Multica's
light value and is only reached on a host that does not define the alias.

| `--ml-*` | Host alias | Fallback |
| --- | --- | --- |
| `--ml-text-micro` … `--ml-text-display` | none (type scale) | 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 36px |
| `--ml-radius-xs` … `--ml-radius-2xl` | none (the host has no matching ladder) | 3 / 4 / 6 / 8 / 12 / 16px |
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
| `--ml-presence-*` | success / warn / caption / brand | as above |

Density constants (`--ml-card-padding`, `--ml-column-width`, `--ml-row-height`)
have no host equivalent and are documented literals.

## Rules

- A ported file keeps its derivation header: upstream path, the pinned
  `multica-x` commit and the copyright line. Re-syncing from Multica means
  updating the header's commit and re-reading the diff, not editing silently.
- Tailwind class lists become module rules on `--ml-*`. Never add a utility
  framework or a PostCSS step: `scripts/build-client.mjs` has none.
- `@multica/ui` primitives become
  `@deepseek-ai/dsh-client-ui-primitives`; Multica icons become inline SVG
  (header retained) or a host icon when one exists.
- Data arrives through props. Ported components never touch `ctx`.
- React 18: ported components that need a ref use `forwardRef`; `use(Context)`
  becomes `useContext`.

## Attribution

`NOTICE`, `licenses/MULTICA-LICENSE` and the Team Settings → About line carry
the Multica License attribution. Internal use only; a hosted third-party
service needs a commercial license from Index Labs.
