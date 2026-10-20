// Derived from multica-x packages/views/agents/components/agents-page.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad and
// packages/views/agents/components/agent-overview-pane.tsx. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's page reads Agent + AgentTask rows from its
// stores and derives presence from a runtime registry. The Team Room has no
// runtime registry, so the same facts come from the roster status, the live
// Member activity snapshot and the board's own catalog (`view`). Everything
// here is DOM-free so the model can be unit-tested without React.

import type {
  AgentTeamClientMemberStatus,
  AgentTeamMemberActivity,
  AgentTeamSessionRun,
  AgentTeamTask,
  AgentTeamThreadRef,
  AgentTeamThreadTurnFailure,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { AgentAvailability, TaskStatus } from '../multica/types.ts'
import { toDateOnly } from '../multica/date.ts'
import { formatTokens, UNKNOWN } from '../reply-stats.ts'

/** Days the Runs tab's token sparkline covers, today included. */
export const SPARKLINE_DAYS = 14

/** Run wall time: `42s`, `3m 5s`, `2h 14m`. */
export function formatRunTime(runMs: number): string {
  const seconds = Math.max(0, Math.round(runMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Cache hit share of the input side: cache read / (uncached input + cache read). Unknown input or an empty denominator is an em dash. */
export function cacheHitLabel(run: Pick<AgentTeamSessionRun, 'tokensIn' | 'cacheReadTokens'>): string {
  if (run.cacheReadTokens === null) return UNKNOWN
  const total = run.tokensIn + run.cacheReadTokens
  return total === 0 ? UNKNOWN : `${String(Math.round((run.cacheReadTokens / total) * 100))}%`
}

/** A null bucket is unknown, never 0. */
export const tokensOrUnknown = (count: number | null): string => count === null ? UNKNOWN : formatTokens(count)

/** Status columns, in board order; the Tasks tab groups by this. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']

/** Billed tokens of one run: uncached input plus output. Cache reads stay on the Runs row. */
export function tokensOfRun(run: Pick<AgentTeamSessionRun, 'tokensIn' | 'tokensOut'>): number {
  return run.tokensIn + run.tokensOut
}

/** Local calendar day of an ISO timestamp. */
function dayOf(timestamp: string): string | undefined {
  const parsed = new Date(timestamp)
  return Number.isNaN(parsed.getTime()) ? undefined : toDateOnly(parsed)
}

/** Tokens the Member burned today, across every run that started today. */
export function tokensToday(runs: readonly AgentTeamSessionRun[], today: string = toDateOnly(new Date())): number {
  let total = 0
  for (const run of runs) {
    if (dayOf(run.startedAt) === today) total += tokensOfRun(run)
  }
  return total
}

/** One Session the Stop button must cancel: the seat's slot 0 and each busy instance. */
export interface StopTarget {
  readonly slot: number
  readonly sessionId: AgentTeamClientMemberStatus['member']['sessionId']
}

/** True while any of the Member's slots is running a Turn. */
export function isMemberBusy(status: AgentTeamClientMemberStatus, activities: readonly AgentTeamMemberActivity[]): boolean {
  if (activities.some(activity => activity.memberId === status.member.memberId)) return true
  if (status.presence === 'working') return true
  return status.instances.some(instance => instance.presence === 'working')
}

/**
 * Every Session a Stop press must cancel: slot 0 (the seat's own Session) plus
 * each instance that is actually working. Idle instances carry no live Turn,
 * and cancelling them would only churn the controller. Duplicates collapse so
 * one Session is never cancelled twice.
 */
export function stopTargets(status: AgentTeamClientMemberStatus): readonly StopTarget[] {
  const targets: StopTarget[] = [{ slot: 0, sessionId: status.member.sessionId }]
  for (const instance of status.instances) {
    if (instance.presence !== 'working' || instance.sessionId === undefined) continue
    targets.push({ slot: instance.slot, sessionId: instance.sessionId })
  }
  const seen = new Set<AgentTeamClientMemberStatus['member']['sessionId']>()
  return targets.filter(target => {
    if (seen.has(target.sessionId)) return false
    seen.add(target.sessionId)
    return true
  })
}

/** Instances running a Turn over the Member's total slots. */
export function instanceLoad(status: AgentTeamClientMemberStatus): { readonly busy: number; readonly total: number } {
  const total = status.instances.length > 0 ? status.instances.length : status.member.instances ?? 1
  const busy = status.instances.filter(instance => instance.presence === 'working').length
  return { busy, total }
}

/** One Task row the Agent's Tasks tab renders. */
export interface MemberTaskRow {
  readonly taskRef: AgentTeamTask['taskRef']
  readonly threadRef: AgentTeamThreadRef
  readonly channelRef: AgentTeamTask['channelRef']
  readonly status: TaskStatus
  readonly taskNumber: number
  readonly title: string
  readonly channelName: string
  readonly priority: AgentTeamTask['priority']
  readonly position: number
  readonly claimDirection?: string | undefined
}

/** The Member's Tasks: assigned to it, or owned by its active Claim. */
export function memberTaskRows(view: AgentTeamView, memberId: string): readonly MemberTaskRow[] {
  const claimed = new Set(view.claims.filter(claim => claim.owner === memberId && claim.state === 'active').map(claim => claim.taskRef))
  const numbers = new Map(view.taskNumbers.map(row => [row.taskRef, row.taskNumber]))
  const channels = new Map(view.channels.map(channel => [channel.channelRef, channel.name]))
  const claims = new Map(view.claims.filter(claim => claim.state === 'active').map(claim => [claim.taskRef, claim.direction]))
  return view.tasks
    .filter(task => task.assignee === memberId || claimed.has(task.taskRef))
    .map(task => ({
      taskRef: task.taskRef,
      threadRef: task.threadRef,
      channelRef: task.channelRef,
      status: task.status,
      taskNumber: numbers.get(task.taskRef) ?? 0,
      title: task.title ?? `#${numbers.get(task.taskRef) ?? 0}`,
      channelName: channels.get(task.channelRef) ?? '',
      priority: task.priority,
      position: task.position ?? 0,
      ...(claims.has(task.taskRef) ? { claimDirection: claims.get(task.taskRef) } : {}),
    }))
    .sort((left, right) => left.position - right.position || left.taskNumber - right.taskNumber)
}

/** The Task the Member is on right now: the live Turn's Thread, else its first active Claim. */
export function currentTaskOf(
  view: AgentTeamView | undefined,
  memberId: string,
  activity: AgentTeamMemberActivity | undefined,
): MemberTaskRow | undefined {
  if (view === undefined) return undefined
  const rows = memberTaskRows(view, memberId)
  if (activity?.threadRef !== undefined) {
    const live = rows.find(row => row.threadRef === activity.threadRef)
    if (live !== undefined) return live
  }
  return rows.find(row => row.claimDirection !== undefined) ?? rows[0]
}

/** The Tasks tab's groups, status order preserved; empty groups are dropped. */
export function groupTasksByStatus(rows: readonly MemberTaskRow[]): readonly { readonly status: TaskStatus; readonly rows: readonly MemberTaskRow[] }[] {
  return TASK_STATUS_ORDER
    .map(status => ({ status, rows: rows.filter(row => row.status === status) }))
    .filter(group => group.rows.length > 0)
}

/** One day of the Runs sparkline: tokens burned, and how much of them ended in a failure. */
export interface TokenBucket {
  readonly day: string
  readonly total: number
  readonly failed: number
  readonly completed: number
}

/** Session ids that recorded at least one errored Turn, for the sparkline's failure share. */
export function failedSessions(failures: readonly AgentTeamThreadTurnFailure[]): ReadonlySet<string> {
  return new Set(failures.map(failure => failure.sessionId))
}

/**
 * `days` buckets ending today, oldest first. A run counts on the local day it
 * started; a failed run contributes to `failed` so a column carries both
 * throughput and failure share, exactly like the Multica sparkline.
 */
export function tokenBuckets(
  runs: readonly AgentTeamSessionRun[],
  failed: ReadonlySet<string>,
  days: number = SPARKLINE_DAYS,
  today: string = toDateOnly(new Date()),
): readonly TokenBucket[] {
  const [year, month, date] = today.split('-').map(Number) as [number, number, number]
  const buckets: TokenBucket[] = []
  const index = new Map<string, number>()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(year, month - 1, date - offset)
    const day = toDateOnly(cursor)
    index.set(day, buckets.length)
    buckets.push({ day, total: 0, failed: 0, completed: 0 })
  }
  for (const run of runs) {
    const day = dayOf(run.startedAt)
    const slot = day === undefined ? undefined : index.get(day)
    if (slot === undefined) continue
    const tokens = tokensOfRun(run)
    const bucket = buckets[slot]!
    const failure = failed.has(run.sessionId) ? tokens : 0
    buckets[slot] = { day: bucket.day, total: bucket.total + tokens, failed: bucket.failed + failure, completed: bucket.completed + (tokens - failure) }
  }
  return buckets
}

/** Failures grouped by the Session they ended, newest first inside each Session. */
export function failuresBySession(failures: readonly AgentTeamThreadTurnFailure[]): ReadonlyMap<string, readonly AgentTeamThreadTurnFailure[]> {
  const out = new Map<string, AgentTeamThreadTurnFailure[]>()
  for (const failure of failures) {
    const list = out.get(failure.sessionId)
    if (list === undefined) out.set(failure.sessionId, [failure])
    else list.push(failure)
  }
  for (const list of out.values()) list.sort((left, right) => right.sequence - left.sequence)
  return out
}
