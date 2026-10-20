/**
 * The `team_activity` tool: one read-only, workspace-wide activity snapshot for
 * a digest. Who is asking and what they may see come from the Session the Host
 * resolved, exactly like every other Team tool: the caller is an active Team
 * Member, and the rows cover only the Workspaces and Channels that Member
 * already participates in. `execute` copies declared fields only, so an extra
 * argument a model invents never reaches the backend.
 *
 * The tool never mutates Team state: every Host call it makes is a read
 * (view, members, memberActivity, roomActivity, open decisions), and its
 * description says so — the digest member must not act on what it reads.
 *
 * @module @ddvnguyen/moct-dsh-team-room/activity-tools
 */

import { formatTeamTimestamp } from '@ddvnguyen/moct-dsh-team-room/time-format'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { service, workspaceOf, workspaceParam } from './host-access.ts'

/** The model-facing names this module registers. */
export const ACTIVITY_TOOL_NAMES = Object.freeze(['team_activity'] as const)

/** Report window bounds: one minute at least, one week at most, one day by default. */
const SINCE_MINUTES_DEFAULT = 1440
const SINCE_MINUTES_MAX = 10_080

/** Hard output caps; every cap the render crosses is stated with an explicit truncation marker. */
const AGENT_ROW_LIMIT = 24
const OPEN_TASK_LIMIT = 20
const DECISION_LIMIT = 10
const EVENT_LIMIT = 15
const SUBJECT_BOUND = 80

type AgentActivityRow = {
  readonly memberId: string
  readonly handle: string
  readonly presence: string
  readonly availability: string
  readonly running: boolean
  readonly runningThreadRef?: string
  readonly runningTool?: string
  readonly runningSteps?: number
  readonly runningToolCalls?: number
  readonly currentTaskRef?: string
  readonly currentTaskStatus?: string
  readonly idleMinutes?: number
  readonly turns: number
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly failedTurns: number
}

type OpenTaskRow = {
  readonly taskRef: string
  readonly status: string
  readonly title?: string
  readonly priority?: string
  readonly assignee?: string
  readonly minutesSinceLastActivity?: number
}

type DecisionRow = {
  readonly decisionRef: string
  readonly threadRef: string
  readonly askedAt: string
  readonly questions: number
}

type EventRow = {
  readonly at: string
  readonly kind: string
  readonly actor: string
  readonly summary: string
}

/** The windowed per-Member usage the room-activity folds are merged into. */
interface WindowUsage {
  turns: number
  tokensIn: number | null
  tokensOut: number | null
  failedTurns: number
  /** False until a Channel contributed a row; a null seen after that stays sticky. */
  counted: boolean
}

/** A Member with no rows in any visible Channel: nothing ran, so every bucket is a proven 0. */
function emptyUsage(): WindowUsage {
  return { turns: 0, tokensIn: 0, tokensOut: 0, failedTurns: 0, counted: true }
}

/** The one deterministic bounded subject, cut with an explicit truncation mark. */
function boundedText(text: string): string {
  const collapsed = text.replaceAll(/\s+/gu, ' ').trim()
  return collapsed.length <= SUBJECT_BOUND ? collapsed : `${collapsed.slice(0, SUBJECT_BOUND - 1)}…`
}

function clampWindowMinutes(raw: number | undefined): number {
  if (raw === undefined) return SINCE_MINUTES_DEFAULT
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
    throw new Error('sinceMinutes must be a positive whole number of minutes')
  }
  return Math.min(raw, SINCE_MINUTES_MAX)
}

/** Sticky-null merge across Channel scopes: one unproven bucket keeps the whole Member's bucket null. */
function mergeUsage(target: WindowUsage, add: { turns: number; tokensIn: number | null; tokensOut: number | null; failedTurns: number }): void {
  target.turns += add.turns
  target.failedTurns += add.failedTurns
  if (!target.counted) {
    target.tokensIn = add.tokensIn
    target.tokensOut = add.tokensOut
    target.counted = true
    return
  }
  // Null is absorbing in both directions: once this Member's bucket is unproven
  // in any Channel it stays unproven, and it never turns a later number into a
  // total that reads as if the gap had been measured.
  target.tokensIn = target.tokensIn === null || add.tokensIn === null ? null : target.tokensIn + add.tokensIn
  target.tokensOut = target.tokensOut === null || add.tokensOut === null ? null : target.tokensOut + add.tokensOut
}

const teamActivity = defineTool({
  name: 'team_activity',
  description: 'Read-only snapshot of your Workspace\'s whole-team activity for a digest: per-agent state (presence, running turn, current task, idle minutes, turns, tokens and failed Turns in the window), tasks by status with their open rows, open decision cards, and the window\'s top events. Nothing here can be mutated through this tool — it reports only. Call it when asked for a digest or a team standing summary; to read one Thread, use team_thread instead.',
  parameters: {
    sinceMinutes: { type: 'number', description: `How far back the window reaches, in minutes. Default ${SINCE_MINUTES_DEFAULT} (one day); at most ${SINCE_MINUTES_MAX}.` },
    workspace: workspaceParam,
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      workspaceId: { type: 'string', required: true },
      windowMinutes: { type: 'number', required: true },
      since: { type: 'string', required: true },
      agents: { type: 'array', required: true, items: { type: 'json' } },
      agentsTruncated: { type: 'boolean', required: true },
      tasks: { type: 'json', required: true },
      decisions: { type: 'array', required: true, items: { type: 'json' } },
      decisionsTruncated: { type: 'boolean', required: true },
      events: { type: 'array', required: true, items: { type: 'json' } },
      eventsTruncated: { type: 'boolean', required: true },
    } },
    // Renders are the only channel a tool result reaches the model through.
    // The lines mirror the structured value field-for-field; a null usage
    // bucket renders as `unknown` (an unproven number is never a 0), and every
    // cap the value crossed renders its own explicit truncation line.
    render: (_args, value) => {
      const agents = value.agents as unknown as AgentActivityRow[]
      const tasks = value.tasks as unknown as { counts: Record<string, number>; open: OpenTaskRow[]; openTruncated: boolean }
      const decisions = value.decisions as unknown as DecisionRow[]
      const events = value.events as unknown as EventRow[]
      const lines: string[] = [
        `Team activity — Workspace ${value.workspaceId} · window last ${value.windowMinutes} minute(s), since ${formatTeamTimestamp(value.since)} · read-only`,
        '',
        'Agents',
      ]
      if (agents.length === 0) lines.push('No agent Members to report.')
      for (const agent of agents) {
        const segments = [`@${agent.handle} (${agent.presence})`]
        if (agent.running) {
          segments.push(`running${agent.runningTool === undefined ? '' : ` ${agent.runningTool}`}${agent.runningThreadRef === undefined ? '' : ` on ${agent.runningThreadRef}`}${agent.runningSteps === undefined ? '' : ` (steps ${agent.runningSteps}, tools ${agent.runningToolCalls ?? 0})`}`)
        } else if (agent.idleMinutes !== undefined) {
          segments.push(`idle ${agent.idleMinutes}m`)
        }
        if (agent.currentTaskRef !== undefined) segments.push(`task ${agent.currentTaskRef} (${agent.currentTaskStatus ?? 'unknown'})`)
        segments.push(`turns ${agent.turns}`, `in ${agent.tokensIn === null ? 'unknown' : agent.tokensIn.toLocaleString('en-US')}`, `out ${agent.tokensOut === null ? 'unknown' : agent.tokensOut.toLocaleString('en-US')}`, `failed ${agent.failedTurns}`)
        lines.push(`- ${segments.join(' · ')}`)
      }
      if (value.agentsTruncated) lines.push(`+ more agents beyond this page are not shown.`)
      lines.push('', 'Tasks', `todo ${tasks.counts.todo} · in_progress ${tasks.counts.in_progress} · in_review ${tasks.counts.in_review} · done ${tasks.counts.done} · closed ${tasks.counts.closed}`)
      if (tasks.open.length === 0) lines.push('No open Tasks.')
      for (const task of tasks.open) {
        lines.push(`- ${task.taskRef} · ${task.status}${task.priority === undefined ? '' : ` · ${task.priority}`}${task.assignee === undefined ? '' : ` · assignee @${task.assignee}`}${task.title === undefined ? '' : ` — ${task.title}`}${task.minutesSinceLastActivity === undefined ? '' : ` · last activity ${task.minutesSinceLastActivity}m ago`}`)
      }
      if (tasks.openTruncated) lines.push(`+ more open Tasks beyond this page are not shown.`)
      lines.push('', 'Open decisions')
      if (decisions.length === 0) lines.push('No open decision cards.')
      for (const decision of decisions) {
        lines.push(`- ${decision.decisionRef} · ${decision.threadRef} · asked ${formatTeamTimestamp(decision.askedAt)} · ${decision.questions} question(s)`)
      }
      if (value.decisionsTruncated) lines.push(`+ more open decisions beyond this page are not shown.`)
      lines.push('', 'Events')
      if (events.length === 0) lines.push(`No events in the window.`)
      for (const event of events) {
        lines.push(`- ${formatTeamTimestamp(event.at)} ${event.actor} ${event.kind} — ${event.summary}`)
      }
      if (value.eventsTruncated) lines.push(`+ more events beyond this page are not shown.`)
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_activity requires an Agent session')
    const host = service(agent)
    const workspaceId = workspaceOf(args, agent)
    const windowMinutes = clampWindowMinutes(args.sinceMinutes)
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()

    const view = host.viewForAgent(agent, { workspaceId, topLevelOnly: true, includeActivities: false, direction: 'before', includeCatalog: true })
    const statuses = host.members()
    const running = host.memberActivity({ workspaceId }).activities
    // Open cards are a Workspace-wide read on the Host, so the tool narrows them
    // to the Channels this caller can see: a digest never names a Thread the
    // reading Member could not open.
    const visibleChannels = new Set(view.channels.map(channel => channel.channelRef))
    const decisions = host.openDecisionsForAgent(agent, { workspaceId }).filter(decision => visibleChannels.has(decision.channelRef))

    // One windowed room-activity read per Channel the caller can see: usage
    // and sessions merge into per-Member rows, events feed one merged page.
    // Sessions under a `since` fold are the ones with activity in the window,
    // so their lastAssistantAt is the freshest per-Member activity instant the
    // window can prove.
    const usageByMember = new Map<string, WindowUsage>()
    const lastActivityByMember = new Map<string, number>()
    const events: EventRow[] = []
    let channelPageTruncated = false
    for (const channel of view.channels) {
      const activity = host.roomActivity({ workspaceId, channelRef: channel.channelRef, since, limit: EVENT_LIMIT })
      for (const agentUsage of activity.perAgent) {
        const target = usageByMember.get(agentUsage.memberId) ?? { turns: 0, tokensIn: 0, tokensOut: 0, failedTurns: 0, counted: false }
        mergeUsage(target, agentUsage)
        usageByMember.set(agentUsage.memberId, target)
      }
      for (const session of activity.sessions) {
        const at = Date.parse(session.lastAssistantAt)
        const current = lastActivityByMember.get(session.memberId)
        if (!Number.isNaN(at) && (current === undefined || at > current)) lastActivityByMember.set(session.memberId, at)
      }
      events.push(...activity.events.map(event => ({ at: event.at, kind: event.kind, actor: event.actor, summary: event.summary })))
      // A Channel whose own page stopped early has more rows than it returned,
      // so the merged page is incomplete even when the merge itself fits.
      if (activity.nextCursor !== undefined) channelPageTruncated = true
    }
    events.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    const totalEvents = events.length

    const runningByMember = new Map<string, typeof running[number]>()
    for (const activity of running) if (!runningByMember.has(activity.memberId)) runningByMember.set(activity.memberId, activity)
    const activeTaskByMember = new Map<string, { taskRef: string; status: string }>()
    for (const active of view.activeTaskThreads) {
      for (const participant of active.members) activeTaskByMember.set(participant.memberId, { taskRef: active.taskRef, status: active.status })
    }

    const participantIds = new Set(view.members.map(membership => membership.memberId))
    const agentRows: AgentActivityRow[] = []
    let agentsTruncated = false
    for (const status of statuses) {
      const memberId = status.member.memberId
      if (!participantIds.has(memberId)) continue
      if (agentRows.length >= AGENT_ROW_LIMIT) {
        // One more participant than the page carries: the snapshot is
        // truncated, and it says so rather than reading as the whole team.
        agentsTruncated = true
        break
      }
      const usage = usageByMember.get(memberId) ?? emptyUsage()
      const runningActivity = runningByMember.get(memberId)
      const activeTask = activeTaskByMember.get(memberId)
      const lastActivityMs = lastActivityByMember.get(memberId)
      agentRows.push({
        memberId,
        handle: status.member.handle,
        presence: status.presence,
        availability: status.availability,
        running: runningActivity !== undefined,
        ...(runningActivity?.threadRef === undefined ? {} : { runningThreadRef: runningActivity.threadRef }),
        ...(runningActivity?.current === undefined ? {} : { runningTool: runningActivity.current.tool }),
        ...(runningActivity === undefined ? {} : { runningSteps: runningActivity.stepCount, runningToolCalls: runningActivity.toolCount }),
        ...(activeTask === undefined ? {} : { currentTaskRef: activeTask.taskRef, currentTaskStatus: activeTask.status }),
        ...(runningActivity !== undefined ? { idleMinutes: 0 }
          : lastActivityMs !== undefined ? { idleMinutes: Math.max(0, Math.floor((Date.now() - lastActivityMs) / 60_000)) } : {}),
        turns: usage.turns,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        failedTurns: usage.failedTurns,
      })
    }

    const counts: Record<string, number> = { todo: 0, in_progress: 0, in_review: 0, done: 0, closed: 0 }
    for (const task of view.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1
    const lastActivityByThread = new Map<string, string>()
    for (const active of view.activeTaskThreads) lastActivityByThread.set(active.threadRef, active.lastActivityAt)
    for (const item of view.items) lastActivityByThread.set(item.thread.threadRef, item.lastActivityAt)
    const openTasks: OpenTaskRow[] = view.tasks
      .filter(task => task.status === 'todo' || task.status === 'in_progress' || task.status === 'in_review')
      .map(task => {
        const lastActivityAt = lastActivityByThread.get(task.threadRef)
        const minutes = lastActivityAt === undefined ? undefined : Math.max(0, Math.floor((Date.now() - Date.parse(lastActivityAt)) / 60_000))
        return {
          taskRef: task.taskRef,
          status: task.status,
          ...(task.title === undefined ? {} : { title: boundedText(task.title) }),
          ...(task.priority === undefined ? {} : { priority: task.priority }),
          ...(task.assignee === undefined || task.assignee === null ? {} : { assignee: task.assignee }),
          ...(minutes === undefined || Number.isNaN(minutes) ? {} : { minutesSinceLastActivity: minutes }),
        }
      })
      .sort((left, right) => (right.minutesSinceLastActivity ?? -1) - (left.minutesSinceLastActivity ?? -1))

    return {
      workspaceId,
      windowMinutes,
      since,
      agents: agentRows,
      agentsTruncated,
      tasks: {
        counts,
        open: openTasks.slice(0, OPEN_TASK_LIMIT),
        openTruncated: openTasks.length > OPEN_TASK_LIMIT,
      },
      decisions: decisions.slice(0, DECISION_LIMIT).map(decision => ({
        decisionRef: decision.decisionRef, threadRef: decision.threadRef, askedAt: decision.askedAt, questions: decision.questions.length,
      })),
      decisionsTruncated: decisions.length > DECISION_LIMIT,
      events: events.slice(0, EVENT_LIMIT),
      eventsTruncated: totalEvents > EVENT_LIMIT || channelPageTruncated,
    }
  },
})

export const activityTools = [teamActivity] as const

export function registerActivityTools(ctx: { tools: { register(tool: unknown): unknown } }): void {
  for (const tool of activityTools) ctx.tools.register(tool)
}
