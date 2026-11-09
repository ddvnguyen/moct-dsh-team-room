// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's timeline collapses a run of consecutive
// activities into one `activity-group` item that expands on click. The port
// keeps that shape — one summary line while closed, the same facts listed
// oldest first when open — and derives the summary from the kinds rather than
// storing it, so it cannot drift from the rows under it.

import { useMemo, useState } from 'react'
import type { AgentTeamActivity, AgentTeamIssueActivityFact, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { formatActivity } from '../team-formatters.ts'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-timeline.module.css'

/**
 * Which summary bucket one activity counts in.
 *
 * A `Record` over the kind union, not a switch with a fallthrough: a kind the
 * ledger adds later fails the typecheck here instead of silently rendering an
 * empty group summary.
 */
const CATEGORY: Readonly<Record<AgentTeamActivity['kind'], 'status' | 'claim'>> = {
  promote: 'status',
  assign: 'status',
  accept: 'status',
  close: 'status',
  reopen: 'status',
  patch: 'status',
  claim: 'claim',
  done: 'claim',
  release: 'claim',
  claims_released: 'claim',
}

/** The collapsed line's words: only the buckets that happened, in a fixed order. */
export function activitySummary(facts: readonly AgentTeamIssueActivityFact[], t: TeamConversationProps['t']): string {
  let status = 0
  let claim = 0
  for (const fact of facts) {
    if (CATEGORY[fact.activity.kind] === 'status') status += 1
    else claim += 1
  }
  const parts: string[] = []
  if (status > 0) parts.push(t('issueActivityStatusCount', { count: String(status) }))
  if (claim > 0) parts.push(t('issueActivityClaimCount', { count: String(claim) }))
  return parts.join(t('issueActivityGroupJoin'))
}

export interface IssueActivityGroupProps {
  /** Consecutive activity facts: the group boundary is the caller's, never re-derived here. */
  readonly facts: readonly AgentTeamIssueActivityFact[]
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  readonly t: TeamConversationProps['t']
}

/**
 * One run of consecutive activities: a summary line that opens to the facts.
 * Closed by default — the timeline stays a conversation, and the bookkeeping
 * is one click away.
 */
export function IssueActivityGroup({ facts, nameOf, t }: IssueActivityGroupProps) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => activitySummary(facts, t), [facts, t])
  return (
    <div className={css.activityGroup} data-issue-activity-group="" data-activity-group-open={open ? '' : undefined}>
      <button
        type="button"
        className={css.activityGroupToggle}
        aria-expanded={open}
        data-issue-activity-group-toggle=""
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.activityMark} aria-hidden="true" />
        <span>{summary}</span>
      </button>
      {open && (
        <ul className={css.activityFacts}>
          {facts.map(fact => (
            <li className={css.activityFact} data-issue-activity-row="" key={fact.activity.activityRef}>
              {formatActivity(fact.activity, { t, actorName: nameOf, claims: [] })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
