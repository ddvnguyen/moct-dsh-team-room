# The Team Board

English | [中文](team-board.zh.md)

The Team Board is the Human's view of a running Agent Team: a kanban of every Task in the Workspace, the detail of one Task and the runs behind it, a page that says what the team is doing right now, an Inbox that says what needs the Human, and an Orchestrator that reports on the team on a schedule.

This guide is the operator's route through those surfaces. The engineering facts behind them live in [`../frontend-design/board.md`](../frontend-design/board.md), [`../team-collaboration/orchestrator-digest.md`](../team-collaboration/orchestrator-digest.md) and [`../architecture/`](../architecture/README.md).

## Who does what

A Member may carry one of four roles. A role is a label plus a fixed instruction block in the Member's identity, never a router: it tells an awake Member how to behave, and it never decides who gets which Task.

| Role | What it is for |
| --- | --- |
| `architect` | Design work with the Human: decisions and plans, no implementation. |
| `leader` | Splits work into steps, hands work to Workers, reviews finished Claims and tells the Human what is ready to accept. |
| `worker` | Claims one Task at a time, implements it, reports the result. |
| `orchestrator` | Watches the whole team and reports. It never claims, assigns or changes a Task. |

## Setting the team up

Members are created from Team Detail → Agents (`添加 Agent`) with a name, a description and a role; the same role select is on the Agent's Config tab, so a Member's role can be changed later, and `null` clears it back to no role.

Give each Member the Channel it works in. A Member only sees the Threads of the Channels it joined, and only the Human can invite a Member into a Thread.

The Orchestrator is the one Member whose model choice matters most: a digest is a summarization over a bounded snapshot, so a cheap model is the right one. Spend the expensive model on the Members that do the work.

## Skills

An Agent's Skills tab is where its loadable skills are managed. The list is the Agent's whole catalog — the plugin's read-only bundled skills and the skills the Agent installed into its own directory — and each row names the origin it came from.

**Load every skill** is the default and stays honest: skills installed later load automatically. Un-ticking one row writes an explicit selection naming every other skill. The hint under the toggle says so, because a selection that never mentions future skills is the trap.

Saving is never optimistic: the page re-reads the Agent's catalog after the Host commits, so the checkboxes show what is stored, not what was clicked. A selection takes effect at the Agent's next turn boundary, in the same Session.

## The board

The Board is opened from the sidebar's main panel list — the Board row (`agent-team-board`); it opens the kanban in the main column, because five 280-pixel columns do not fit the strip's narrow rail. The board is a navigation face: a reload reopens it where it was left.

Five columns, one per Task status: `待办` (todo), `进行中` (in progress), `待评审` (in review), `已完成` (done), `已关闭` (closed).

`新建任务` opens the create dialog: title, description, Channel, priority and assignee. The defaults are the rules — the assignee starts at **未分配**, because creating never assigns, and the Channel defaults to the last one a Task was created in.

### Drag rules

| Drop | Effect |
| --- | --- |
| → `已完成` | Accept the Task |
| → `已关闭` | Close the Task |
| → `待办` from done or closed | Reopen the Task |
| → `进行中` / `待评审` | Refused: the card snaps back and the hint names the rule |

The two refused columns are the point of the board. In progress and in review are set by Agents claiming work: a Task is in progress while a Claim on it is open, and it waits in review once that Claim is done. A drag can only accept, close or reopen — the Human's three decisions — so the board cannot show a Task as worked on when nobody worked on it.

Nothing moves optimistically. A dropped card waits for the Host to commit and for the board to refetch, and a refused drop snaps back with the reason on screen.

The filter bar narrows the columns by Channel, assignee, priority and free text.

### GitHub Issues as the board's store

The source switch at the top of the board (`团队任务` | `GitHub`) draws the same board from GitHub instead of the Team ledger. GitHub is the store: the cards are issues, and a drop writes the bound project's `Status` field on GitHub.

Without a project the columns are the two issue states. Nothing is mirrored into the ledger, and nothing moves optimistically: the card moves once the re-read returns it in its new column. The `No status` bucket holds the issues the project does not place, and refuses a drop rather than clearing a field.

A card opens the issue panel, the place the work is talked about. It carries the description, the state, the labels and assignees, and the issue's whole conversation. A comment posted there goes to GitHub, and the panel re-reads before the comment appears.

Labels and assignees are edited there too. The field offers the repository's own labels and assignable people, read with the board, so a choice is always a name GitHub knows: a `×` on a chip removes it and the add-picker offers what is not attached.

GitHub replaces both fields wholesale, so each edit sends the complete new set. A refused write leaves the chips as GitHub holds them, with the reason on screen.

The panel is addressable: an open issue is `?ghIssue=<number>`, so a reload reopens it and the URL is shareable. The parameter is the GitHub board's own and leaves the Team's query parameters alone.

`新建 Issue` creates the issue in GitHub, placed in the project's first status when a project is bound.

Configuration is the deployment's, read from the environment at every call:

| Variable | Meaning |
| --- | --- |
| `DSH_AGENT_TEAM_GITHUB_REPO` | `owner/repo`; required |
| `DSH_AGENT_TEAM_GITHUB_TOKEN` | a token with issue read/write; falls back to `GITHUB_TOKEN` |
| `DSH_AGENT_TEAM_GITHUB_PROJECT` | optional Projects v2 number; its `Status` field becomes the columns |
| `DSH_AGENT_TEAM_GITHUB_API` | optional API base of a GitHub Enterprise instance |

The project may be linked to the repository, or held by the repository owner as a user project or an organization project; all three are found from the number. A number that resolves nowhere is named as an error rather than quietly falling back to the two issue states.

One page is read — the newest 100 issues, the first 100 comments — and each cap says so when it is crossed. A deployment with no repo or no token shows its setup instead of an empty board.

## The issue

A card's title opens the Task's **issue**, not its Thread. The issue opens as a dialog over whatever the reader is on — the board, the Inbox, or a Thread a Task was cited in — and `最大化` turns it into the whole column; `回到浮层` puts it back.

Esc closes it and returns the focus to the card the reader came from, and a reload reopens it where it was. The URL's `issue` query names the Task, so a copied link opens the same issue.

The issue is one read of the Host's own snapshot, drawn in seven regions: the header (the Channel breadcrumb, `#n`, the status and the inline title editor), the description, the properties column (status, priority, assignee, created and last activity), the comment thread and its composer, the activity, the decisions, and the execution log.

Nothing moves before the Host commits it: a rename, a comment or a picker waits for the commit and for the change to arrive, and a rejected write snaps back and says why.

The decisions region is where a question waits for the Human: an ask from a seat is a card with its questions and a recommended answer, and a decision already taken is a row naming who decided, what was decided, why and when.

The plan a seat proposes becomes the issue's description once the Human approves it, and that approval is one of those rows. Both tools are documented in [`../team-collaboration/tools.md`](../team-collaboration/tools.md).

## The legacy Thread

The Thread view is **legacy** (D10). It is not deleted: the issue's header carries `打开旧版 Thread 视图`, and the Channel feed still opens Threads.

Both surfaces read the same Host facts — a comment written on the issue is a comment on the Thread, and a Thread opened from the issue is the same Thread. It takes fixes only from here on: no new region and no new write.

## The execution log

The execution log lists the Sessions that ran this Thread. The active run comes first with a live clock, the tool it is running and its step count; past runs carry their duration, the token flow `in → out`, the cache share, the tool and turn counts and the model. A failed Turn is flagged, and `打开会话` opens that seat's own Session.

The status, priority and assignee pickers sit in the issue's properties column, so a Task can be re-pointed without leaving the issue.

## Stop and Chat

**Stop** and **Chat** answer different questions, and mixing them up costs a run.

`停止` in the execution log cancels the Turn that is running right now, on that seat, for that Thread. It asks first, naming the Member whose Turn it is about to cancel, and it says what is kept: unfinished work stays in that Member's Inbox. The log does not pretend the run has stopped — it shows `停止中…` until the Host folds the run out of the active list.

`聊天` on the Agent page opens the Member's own Session, where the Human talks to it. It is a conversation, not a control: nothing is cancelled, no Task changes, and the Session's own history stays where it is.

Use Stop to end a run that is going the wrong way. Use Chat to talk to the Member, or to give the next instruction to a Session that is idle.

## Overview

The `总览` section of the **Team Detail** page answers "what is going on in this team right now and today". The side menu's `团队详情` row opens that page, whose sections are `总览` (Overview), `Agents`, `团队记忆` (Team memory) and `设置` (Settings); the Workspace picked above the sections scopes all four. The Overview holds four blocks:

- **实时 Agents** — one card per Member with presence, its current Task and the tool it is running, updated live;
- **需要关注** — open decision cards, failed Turns and Tasks waiting for the Human;
- **动态** — the Workspace-wide event feed, newest first;
- **消耗** — tokens per Agent for the day and per day over the last two weeks. A day or an Agent whose input usage was never recorded shows as unrecorded instead of as a zero, so a gap in the data never reads as a quiet day.

## Inbox severities

The Inbox groups what needs the Human by how loudly it should ask:

| Severity | Meaning |
| --- | --- |
| `action_required` | Only the Human can settle it: a decision card, a Task waiting for acceptance. |
| `attention` | Someone mentioned the Human, or a run needs a look. |
| `info` | Progress worth knowing about, including the Orchestrator's digest. |

The severity filters combine with the status, priority, actor and Channel filters, and an unread-only filter narrows the queue further.

## The Orchestrator digest

The digest is a scheduled report from the Orchestrator into a Channel of its own. It is off by default and configured on the Team Host row:

```yaml
- id: wowyuarm-agent-team-host
  name: '@ddvnguyen/moct-dsh-team-room/host'
  config:
    digest:
      enabled: true
      intervalMinutes: 1440
      dailyAt: '09:00'
      channel: team-digest
```

`enabled` turns the timer on, `intervalMinutes` is both the tick and the window the digest reports on, `dailyAt` replaces the interval with a daily fire time, and `channel` names the Channel the digest is posted to — created on the first tick when it is missing. Every field is volatile, so a change lands on the running Host without a restart.

The digest itself is an ordinary Thread Message: the Orchestrator reports what needs attention, which Agents are stalled, where the cost outliers are and how the work is progressing, and it takes no other action.

## Attribution

The Board, the Task detail, the Agent pages, the Overview and the Inbox are ports of Multica's surfaces under the Multica License. The ported files carry the upstream path and the pinned commit they were taken from, `NOTICE` lists those pins, the license text is in `licenses/MULTICA-LICENSE`, and the Team Detail → Settings line carries the attribution.
