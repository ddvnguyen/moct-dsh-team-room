# Board

English | [中文](board.zh.md)

The Board is the workspace's kanban: every Task of the selected Workspace, one column per status, opened from the strip's `看板` tab (`Tasks | Board | Team | Agents | Scheduled`). It is the Human's view of what the Team is doing — what is queued, what Agents claimed, and what is finished — and the one surface where a Human moves Tasks between the statuses Agents do not claim.

The page is `TeamBoardPage` in `packages/client-agent-team/src/client/board/`, a port of Multica's board view under the Multica License (see [`multica-look.md`](multica-look.md)). The look layer, the ported helpers and the shared pickers it reuses are documented there.

## Opening the board

The `看板` tab is a native strip tab inserted by the client (`team-tab.ts`, order 2). Its body is the strip's own slice — a Workspace picker and one `打开看板` action — because the strip lives in the host's narrow sidebar where five 280px columns would only scroll. The action selects the Workspace and hands the Team seat to the board face.

The board is a navigation face like the Inbox (`board: true` in the persisted `dsh.agent-team.navigation` snapshot): opening it clears the Channel/Thread faces, a reload reopens it, and picking a card leaves it through the Thread setters.

## Columns and cards

Five fixed columns, one per Task status (`todo`, `in_progress`, `in_review`, `done`, `closed`), built from the Workspace's `view` catalog with `includeCatalog: true`. The catalog read is a `TeamQueries` entry keyed `board:<workspaceId>` that covers the `workspace` and `channel` change scopes, so Task commits and Thread wakes refetch it while presence wakes do not.

A card shows:

- the priority icon and `#<taskNumber>` (top left);
- the live agent activity indicator (top right) when the assignee or a Claim owner has a live `memberActivity` snapshot on the Task's Thread;
- the title (or `#<taskNumber>` when a Task has no title yet);
- the Channel pill and the assignee avatar;
- the Task's active Claim direction line, when one is running.

Columns virtualise long lists with `react-virtuoso`; each column's menu offers `隐藏列`, and hidden columns come back from the `已隐藏的列` rail. Hidden columns are a UI preference in this browser (`dsh.agent-team.board.hiddenColumns` in localStorage), never a data fact.

## Creating a Task

`新建任务` opens the create dialog: title, description (a plain textarea), Channel, priority, and assignee. The defaults are the rules:

- the assignee starts at **未分配** — creating never assigns;
- the Channel defaults to the last Channel a Task was created in, remembered in this browser (`dsh.agent-team.board.lastChannel`), then the first visible Channel.

`创建` calls the `createTask` Remote: one commit mints the unassigned Task and its opening Message on the chosen Channel. The dialog closes on the commit and the catalog refetch carries the new card into `todo`.

## Drag rules

Dragging uses dnd-kit (`PointerSensor`, 5px activation; `pointerWithin` before `closestCenter`). The rules are the collaboration model's, enforced on the drop:

| Drop | Effect |
| --- | --- |
| → `done` | `changeTask` with `accept` |
| → `closed` | `changeTask` with `close` |
| → `todo` from `done`/`closed` | `changeTask` with `reopen` |
| → `in_progress` / `in_review` | rejected: the card snaps back and the hint names the rule (`进行中与待评审由 Agent 认领设定`) — these statuses are set by Agents claiming work, never by a drag |
| within one column | `updateTask` with a fractional `position` between the neighbours |

The house rule is **no optimistic mutations**: a drop never moves data locally. The dropped card enters a settling state (`useDragSettle` holds the mirror while the Remote runs), the card moves only after the Remote commits and the change wake refetches the catalog, and an error snaps the card back with the Remote's message as an inline notice.

Clicking a card opens the Task's Thread (the existing Thread face).

## Filters

The filter bar narrows what the columns show: Channel, assignee (including `未分配`), priority and free text, using the ported `multica/filter.ts` and `multica/sort.ts` helpers. Filters are view state, not persisted preferences; an empty board with active filters shows the empty columns, an empty board without them shows the board-level empty state.

## Live agent activity

The activity indicators read the `memberActivity` snapshot (current tool, step and tool counts, turn start) and refresh on the `activity` change scope through `subscribeChanges`, so a badge appears within about a second of the Session's `session/event`. Activity is presentational: it never changes a Task's status, which stays derived from Claims on the Host.
