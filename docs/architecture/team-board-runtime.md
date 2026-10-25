# The Team Board runtime

English | [中文](team-board-runtime.zh.md)

This note records the runtime seams the Team Board stack added: the durable op kinds a Task now owns, the read-only aggregate the Overview reads, the Host-side timer behind the Orchestrator digest, and the policy that governs the files ported from Multica. The boundaries those seams sit inside are in [`host-authority.md`](host-authority.md) and [`client-and-remote.md`](client-and-remote.md); the Collaboration semantics are in [`../team-collaboration/`](../team-collaboration/README.md).

## The Task op kinds

Two durable records carry the Task fields the Board needs. Both are append-only ledger operations, so both replay identically and an older ledger without them replays unchanged.

`team/task-created` is one commit: the opening Message, the Task overlay, the Thread and the Inbox delta travel together, so a Task never exists without the Message that opened it.

`team/task-updated` carries a `baseRevision` and a patch of `title`, `priority`, `assignee`, `position` and the description (`description` with the description's own fence, `descriptionRevision`). It never revises the Thread's Messages. When the patch moves the Task to a different Member, the same record carries the public `assign` Activity — the wake of the new assignee is a projection of that record, not a side effect of the commit, so a replay derives the same wake.

Status is not one of those fields. Acceptance, closing and reopening ride `team/task-changed`, because they are decisions about the Task's work, not about its description.

## The workspaceActivity Remote

`workspaceActivity` is a read-only aggregate over one Workspace: it returns the `roomActivity` fold of every Channel at once, plus per-day spend buckets. It reads the ledger and the Session runs; it writes nothing, opens no receipt, marks nothing unread and wakes nobody.

| Field | Meaning |
| --- | --- |
| `totals` | The Workspace's own totals, the same shape `roomActivity` returns for one Channel. |
| `perAgent` | Each Member's share of those totals. |
| `perDay` | One bucket per local day: tokens in and out, run milliseconds, and each Member's share of that day. |
| `sessions` | The Session runs behind those numbers. |
| `events` | The newest-first event feed, paged by an opaque `cursor` (default 50 rows, clamped to 200). |

The aggregate is one extension of the `roomActivity` fold rather than a second implementation of it: the Workspace scope asks the same projection for every Channel and adds the day buckets. That is why it needs no Channel ref, why a Workspace answers before any Channel exists, and why an empty Workspace is a valid empty aggregate.

The Client's Overview page reads it and follows the `workspace` and `activity` change scopes.

## The digest timer

The digest runs on a Host-side timer, not on the Harness schedule service: a schedule reminder binds to one Session id, and a Member's Session changes on rollover and renewal. The timer re-arms itself and resolves the live seat at every tick instead.

Its configuration is the `digest` section of the Team Host row, and every field is volatile, so a change lands on the running Host without a restart.

| Field | Meaning | Default |
| --- | --- | --- |
| `enabled` | Whether the timer runs at all | `false` |
| `intervalMinutes` | Minutes between ticks, and the window the digest reports on | `1440` |
| `dailyAt` | Optional daily fire time `HH:MM`, Host-local; it replaces the interval as the schedule | unset |
| `channel` | Name of the Channel digests are posted to; created when missing | `team-digest` |

A tick wakes each enabled Orchestrator that is idle and delivers one report-only instruction through `agent.followup`; a busy Member is skipped and caught by the next tick, because a digest must never steer a running turn. The digest adds no op kind of its own: the report itself is an ordinary `team/message-sent` in the digest Channel, which the first tick creates when it is missing.

The read-only `team_activity` tool is the snapshot behind that instruction: per-agent state, Tasks by status with their age, open decision cards and the window's top events, bounded with explicit truncation markers.

## The Multica reuse policy

The Board, the Task detail, the Agent pages, the Overview and the Inbox are ports of Multica's surfaces. The ported code lives in `packages/client-agent-team/src/client/multica/` and `multica-ui/`, beside the `multica-look.module.css` surface, and any other file whose opening comment names `multica-x` carries the same header.

Every ported file opens with its origin and the upstream commit it was taken at:

```ts
// Derived from multica-x packages/views/issues/components/status-icon.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
```

`npm run check:multica` (`scripts/check-multica-provenance.mjs`) asserts three facts: every ported file carries that header, no Client source imports a `@multica/*` specifier (Multica's own packages are bound to Multica's server API), and every commit named in a header is pinned in `NOTICE`.

Re-syncing a ported file is a diff against the commit its header names, not a fresh copy from upstream: take the upstream file at that commit, re-apply the local adaptation the header's second comment block records, then advance the pin in the header and in `NOTICE` together.

`NOTICE` pins every commit a header names: the source files' commit, the look-and-feel tokens' commit (an ancestor of it), and the descendant commit the board's collapsed column strip was taken at.
