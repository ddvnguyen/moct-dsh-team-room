// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's right-hand property sections — status,
// priority, assignee and the dates — ported as the issue view's properties
// region. The pickers are the ones already ported in `multica-ui/`; they
// write through the Host's `updateTask` / `changeTask` paths, which is the
// Human's own path. The region renders the contract's `properties` value as
// given: it derives no fact the Host already decided.

import type { AgentTeamIssueProperties, AgentTeamMemberId, AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'
import { normalizePriority } from '../multica/priority.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { StatusPicker } from '../multica-ui/StatusPicker.tsx'
import { PriorityPicker } from '../multica-ui/PriorityPicker.tsx'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import type { TeamConversationProps } from '../slots.ts'
import { useMemo } from 'react'
import css from './issue-view.module.css'

export interface IssuePropertiesProps {
  /** The Host-resolved board facts of this Task (R4). */
  readonly properties: AgentTeamIssueProperties
  /** The seats the assignee picker offers. */
  readonly members: readonly AssigneeOption[]
  /** Moves the Task's status; the Host owns which transitions a Human may make. */
  readonly onStatus: (status: TaskStatus) => void
  /** Moves the Task's priority. */
  readonly onPriority: (priority: AgentTeamTaskPriority) => void
  /** Assigns the Task, or clears the assignment with null. */
  readonly onAssignee: (memberId: AgentTeamMemberId | null) => void
  /** A write is in flight; the pickers wait for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's properties: the facts a reader can see and a Human can change.
 * Every value here is the Host's; the client renders it and writes through the
 * Human path.
 */
export function IssueProperties({ properties, members, onStatus, onPriority, onAssignee, pending, t }: IssuePropertiesProps) {
  // The sidebar's relative times, the way the Thread page prints them.
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  return (
    <section className={css.propSection} aria-label={t('propertiesLabel')}>
      <div className={css.propRow}>
        <span className={css.propLabel}>{t('propStatus')}</span>
        <span className={css.propControl}>
          <StatusPicker status={properties.status} onChange={status => { if (!pending) onStatus(status) }} t={t} />
        </span>
      </div>
      <div className={css.propRow}>
        <span className={css.propLabel}>{t('propPriority')}</span>
        <span className={css.propControl}>
          <PriorityPicker priority={normalizePriority(properties.priority)} onChange={priority => { if (!pending) onPriority(priority) }} t={t} />
        </span>
      </div>
      <div className={css.propRow}>
        <span className={css.propLabel}>{t('propAssignee')}</span>
        <span className={css.propControl}>
          <AssigneePicker assignee={properties.assignee} members={members} onChange={memberId => { if (!pending) onAssignee(memberId as AgentTeamMemberId | null) }} t={t} />
        </span>
      </div>
      <div className={css.propRow}>
        <span className={css.propLabel}>{t('propCreated')}</span>
        <span className={css.propControl}>{timeAgo(properties.createdAt)}</span>
      </div>
      <div className={css.propRow}>
        <span className={css.propLabel}>{t('propUpdated')}</span>
        <span className={css.propControl}>{timeAgo(properties.updatedAt)}</span>
      </div>
    </section>
  )
}
