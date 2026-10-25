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
| `AgentActivityIndicator` | `views/issues/components/issue-agent-activity-indicator.tsx` + `agents/components/agent-activity-hover-content.tsx` | `memberActivity` snapshot as props; dsh `HoverCard` with `inline`, so keyboard focus opens the per-Turn details and the badge text already carries tool and step for touch |
| `StatusPicker` | `views/issues/components/pickers/status-picker.tsx` | five statuses; only todo/done/closed enabled |
| `PriorityPicker` | `views/issues/components/pickers/priority-picker.tsx` | display order kept; no deferred popup |
| `AssigneePicker` | `views/issues/components/pickers/assignee-picker.tsx` + `property-picker.tsx` | members only; "Unassigned" writes null; no squads |
| `PickerMenu` / `PickerItem` | `views/issues/components/pickers/property-picker.tsx` | dsh `Menu` owns outside-click, Escape and focus return; the list is portaled, the trigger name is `field: value`, and the trigger stops its click so a clickable card does not open |

The parity audit (`node scripts/audit-ui-parity.mjs`) walks subdirectories, so a
sheet under `multica-ui/` follows the same focus, token and geometry rules as
the top-level sheets.

## Board

The board keeps Multica's kanban rhythm; `board/board.module.css` carries it on `--ml-*`. A collapsed column is a 44px strip with the status glyph, the name written vertically and the count pill.

- `board/CollapsedBoardColumn.tsx` derives from `board-column.tsx`'s strip: the glyph, the vertical name and the count, and no droppable — a collapsed column is a label, not a target.
- `board/collapsed-columns.ts` keeps the per-Workspace collapsed set in localStorage instead of Multica's view store.

## Task detail

The Thread page follows Multica's issue detail layout.

- `thread/ExecutionLog.tsx` derives from Multica's `execution-log-section.tsx`
  and `inline-comment-run.tsx`.
- Data: `threadSessions` (per seat: active run plus history), `memberActivity`
  for the live tool line, `threadTurnFailures` for errored runs.
- Stop goes through `session.cancel` behind a confirm dialog, with a
  non-optimistic stopping state; a row opens the seat's native Session.
- Header, inline title editor and the sidebar rows (status, priority, assignee,
  claims, followers, times) follow the issue layout; under 768px the sidebar
  becomes a dsh `Sheet`.
- `thread-detail.module.css` carries the layout on `--ml-*`.

## Agent pages

The Agents tab and the Agent detail page follow Multica's Agents list and
Agent page.

- `agents/agent-list-toolbar.tsx` derives from `agent-list-toolbar.tsx`, but
  keeps search, role and presence always visible instead of a filter popover:
  the roster is small and fully local, so every control is a plain form field.
- `agents/agent-row.tsx` derives from `agents-page.tsx`: avatar with presence
  dot, handle, role pill, the Task it is on, its live tool, instance load and
  today's tokens.
- `agents/agent-runs-tab.tsx` and `agents/Sparkline.tsx` derive from
  `tabs/activity-tab.tsx` and `sparkline.tsx`: `memberSessions` rows plus a
  14-day token chart, with failure share from `threadTurnFailures`.
- `agents/agent-tasks-tab.tsx` groups the Tasks the Member owns by status and
  reuses `BoardCard` in its compact, read-only face rather than a second card.
- The detail header's Chat opens the Member Session; Stop cancels slot 0 and
  every working instance through `session.cancel`, behind a confirm dialog.
- `agents/agent-page-model.ts` holds the pure derivations (current Task,
  today's tokens, stop targets, buckets) with node-level specs.

## Inbox

The Team Inbox follows Multica's inbox: one queue grouped by what it asks of
the reader, facet filters with their counts, and a split view that opens the
selected row's task detail beside the list.

- `inbox/inbox-items.ts` holds the row model: the Host's projection joined
  with the Thread's open decision cards (#109) and its failed Turns, and the
  severity they imply.
- `inbox/inbox-display.ts` holds the grouping and the labels: the bands, the
  reason word and the detail subject.
- `inbox/InboxList.tsx` derives from `inbox-list.tsx`: the virtualized
  scroller (`react-virtuoso`), the arrow-key walk over the rows, and the band
  headings riding the same list.
- `inbox/InboxListItem.tsx` derives from `inbox-list-item.tsx` and
  `inbox-detail-label.tsx`: the avatar stack, the Task number and title, the
  reason word, the time-ago and the unread dot.
- `inbox/InboxFilterMenu.tsx` derives from `inbox-filter-menu.tsx`: unread,
  severity, channel and agent, with the counts the ported
  `multica/inbox-filter.ts` computes.
- `inbox/inbox.module.css` carries the bands, the rows and the split view on
  `--ml-*`.

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

`NOTICE`, `licenses/MULTICA-LICENSE` and the Team Detail → Settings line carry
the Multica License attribution. Internal use only; a hosted third-party
service needs a commercial license from Index Labs.
