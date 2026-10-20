# The Orchestrator and its scheduled digest

English | [中文](orchestrator-digest.zh.md)

The Orchestrator is a Member with the role `orchestrator`. It watches the whole Workspace and reports; it never acts. This page owns the scheduled digest: what the Orchestrator may do, how the schedule is configured, and where the digest lands.

## The Orchestrator role

`addMember` and `updateMember` set a Member's `role`, and `orchestrator` is one of the four roles. The role is a label plus a fixed prompt section in the Member's identity block — never a routing rule: unassigned Tasks stay unassigned, and the Orchestrator never takes one.

The Orchestrator's job is to summarize what it sees. It reads through the model-facing tools, posts in Threads, and asks the Human through a mention. Everything a normal Member does still applies to it: it holds its own Session, its own memory, and its own context.

## What the Orchestrator may not do

The Orchestrator's surface is the ordinary Team surface minus `team_claim`: the role subtracts it at the restriction seam, so the tool is absent from the Orchestrator's request rather than refused at call time. A surface that predates the role still refuses the call, and `team_message` with `asTask` is refused for an Orchestrator in every case.

That leaves a report-only Member: it can read, post, ask, and answer, and it cannot change Task state, hold a Direction Claim, or steer another Member.

## The digest schedule

The digest runs on a Host-side timer, not on the Harness schedule service: a schedule reminder binds to one Session id, and a Member's Session changes on rollover and renewal. The Host resolves the live seat at every tick instead.

The schedule lives in the `digest` section of the Team Host row. Every field is volatile, so enabling, disabling, or retiming the digest lands on the running Host without a restart.

| Field | Meaning | Default |
| --- | --- | --- |
| `enabled` | Whether the digest scheduler runs at all | `false` |
| `intervalMinutes` | Minutes between ticks; also the window the digest reports on | `1440` |
| `dailyAt` | Optional daily fire time `HH:MM` (Host-local); when set, it replaces the interval as the fire schedule | unset |
| `channel` | Name of the Channel digests are posted to; created when missing | `team-digest` |

A deployment sets them on the Host row in the profile's patch layer:

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

`intervalMinutes` is also the report window: the prompt asks the Orchestrator for the last N minutes, so a daily digest reports on a day and an hourly one on an hour.

## The digest Channel

The first tick creates the digest Channel when it is missing, with the enabled Members of that Workspace as its members. The name is the `channel` field, so `team-digest` is the default and a deployment can choose another. The Channel is created once: a later tick reuses it, and an existing Channel of that name is adopted rather than duplicated.

The digest is a normal Thread Message in that Channel, which means the Human reads it where every other Team message is read.

## What the digest reports

Each tick wakes the Orchestrator with one instruction: call `team_activity` for the window, then post one digest message covering what needs the Human's attention, which agents are stalled or looping, where the cost outliers are, and how the work is progressing. The instruction says report only — no claim, no assignment, no task-state change.

The Orchestrator is woken only when it is idle. A busy Member is skipped and caught by the next tick, because a digest must never steer a running turn.

`team_activity` is the read-only snapshot behind the digest: per-agent state, current Task, idle minutes, turns, tokens and failed turns in the window, tasks by status with their age, open decision cards, and the window's top events. Its own output is bounded and states every truncation it applies.

## The budget

The Orchestrator's model comes from its Member's own `model` selection. A digest is a summarization job over a bounded snapshot, so a cheap model is the right one; reserve an expensive model for Members that do the work. The prompt, the window, and the Channel are the whole cost of the digest: one turn per tick.
