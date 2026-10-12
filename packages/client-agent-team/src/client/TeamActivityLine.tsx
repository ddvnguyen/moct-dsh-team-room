import { useEffect, useRef, useState } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamMemberActivity, AgentTeamMemberActivityRequest, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from './slots.ts'
import { diagnosticText } from './TeamPresenceDot.tsx'
import css from './activity-line.module.css'

/** One rendered row: a running Turn, a working seat the feed has not reported yet, or a Turn that just failed. */
export type TeamActivityRow =
  | { readonly kind: 'working'; readonly memberId: AgentTeamMemberId; readonly activity: AgentTeamMemberActivity }
  | { readonly kind: 'busy'; readonly memberId: AgentTeamMemberId; readonly handle: string }
  | { readonly kind: 'failed'; readonly memberId: AgentTeamMemberId; readonly handle: string; readonly reason: string }

/** `12s`, `2m 14s`, `1h 3m`: compact like dsh's Work details. */
export function formatActivityElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Fold the Host feed and the roster into rows, in roster order. Only seats in
 * `members` (the addressed Channel's seats) get a row; a seat that worked while
 * this surface watched and then errored keeps a `failed` row until it recovers.
 */
export function activityRows(
  members: readonly AgentTeamClientMemberStatus[],
  activities: readonly AgentTeamMemberActivity[],
  watched: ReadonlySet<AgentTeamMemberId>,
): readonly TeamActivityRow[] {
  const byMember = new Map(activities.map(activity => [activity.memberId, activity]))
  const rows: TeamActivityRow[] = []
  for (const status of members) {
    const { memberId, handle } = status.member
    const activity = byMember.get(memberId)
    if (activity !== undefined) rows.push({ kind: 'working', memberId, activity })
    else if (status.presence === 'working') rows.push({ kind: 'busy', memberId, handle })
    else if (status.presence === 'error' && watched.has(memberId)) {
      rows.push({ kind: 'failed', memberId, handle, reason: diagnosticText(status) || status.presence })
    }
  }
  return rows
}

/**
 * A13 v2: one compact line per working seat directly above the composer —
 * `@seat · <tool label|Thinking> · 2m 14s on this thread · step 5 · 4 tools`.
 * Reads the Host's in-memory activity feed, re-reads on its `activity` scope
 * and on presence (the idle edge), and ticks the timer once a second while a
 * line shows. It overlays the space above the composer, so the message list
 * never moves when a line appears or clears.
 */
export function TeamActivityLine({ workspaceId, threadRef, members, loadMemberActivity, subscribeChanges, t }: {
  readonly workspaceId: AgentTeamMemberActivityRequest['workspaceId']
  /** Thread surfaces narrow the feed to Turns delivered for this Thread. */
  readonly threadRef?: AgentTeamThreadRef
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly loadMemberActivity: TeamConversationProps['loadMemberActivity']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly t: TeamConversationProps['t']
}) {
  const [activities, setActivities] = useState<readonly AgentTeamMemberActivity[]>([])
  const [now, setNow] = useState(() => Date.now())
  const watchedRef = useRef(new Set<AgentTeamMemberId>())

  useEffect(() => {
    let live = true
    let sequence = 0
    const refresh = async () => {
      const mine = (sequence += 1)
      try {
        const result = await loadMemberActivity({ workspaceId, ...(threadRef === undefined ? {} : { threadRef }) })
        if (live && mine === sequence && result.ok) setActivities(result.value.activities)
      } catch {
        // The line is advisory: a failed read keeps the last rows until the next wake.
      }
    }
    void refresh()
    const disposers = [
      subscribeChanges({ kind: 'activity', workspaceId }, update => { if (update.type === 'changed') void refresh() }),
      subscribeChanges({ kind: 'presence', workspaceId }, update => { if (update.type === 'changed') void refresh() }),
    ]
    return () => {
      live = false
      for (const dispose of disposers) dispose()
    }
  }, [workspaceId, threadRef])

  for (const status of members) {
    if (status.presence === 'working') watchedRef.current.add(status.member.memberId)
    else if (status.presence !== 'error') watchedRef.current.delete(status.member.memberId)
  }
  for (const activity of activities) watchedRef.current.add(activity.memberId)
  const rows = activityRows(members, activities, watchedRef.current)
  const ticking = rows.some(row => row.kind === 'working')

  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [ticking])

  if (rows.length === 0) return null
  return (
    <div className={css.overlay} role="status" aria-live="polite" data-team-activity>
      {rows.map(row => {
        if (row.kind === 'failed') {
          return <div key={row.memberId} className={`${css.line} ${css.failed}`}>{t('activityFailed', { handle: row.handle, reason: row.reason })}</div>
        }
        if (row.kind === 'busy') {
          return <div key={row.memberId} className={css.line}><span className={css.pulse} aria-hidden="true" />{t('activityBusy', { handle: row.handle })}</div>
        }
        const { activity } = row
        const text = t('activityWorking', {
          handle: activity.handle.replace(/^@/u, ''),
          label: activity.current?.label ?? t('activityThinking'),
          elapsed: formatActivityElapsed(now - Date.parse(activity.turnStartedAt)),
          step: String(activity.stepCount),
          tools: String(activity.toolCount),
        })
        return <div key={row.memberId} className={css.line} title={text}><span className={css.pulse} aria-hidden="true" />{text}</div>
      })}
    </div>
  )
}
