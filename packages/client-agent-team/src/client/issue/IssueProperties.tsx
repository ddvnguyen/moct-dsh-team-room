// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's right-hand property sections, widened from
// three rows to the panel's three groups — Properties (the writable board
// fields and the dates), Details (the facts a reader needs to place the Task)
// and Related (the counts that name the regions in the column). The pickers
// are the ones already ported in `multica-ui/`; they write through the Host's
// `updateTask` / `changeTask` paths, which are the Human's own path. The
// region renders the contract's `properties` value as given: it derives no
// fact the Host already decided, and every group but Properties starts
// collapsed so the writable fields are what a reader meets first.

import { useMemo, useState, type ReactNode } from 'react'
import type { AgentTeamIssueProperties, AgentTeamMemberId, AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'
import { normalizePriority } from '../multica/priority.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { StatusPicker } from '../multica-ui/StatusPicker.tsx'
import { PriorityPicker } from '../multica-ui/PriorityPicker.tsx'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

/** The label each resolution reads as; the value is the Host's own. */
const RESOLUTION_LABEL_KEY = {
  open: 'propResolutionOpen',
  accepted: 'propResolutionAccepted',
  closed: 'propResolutionClosed',
} as const

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
  /** The counts the Related group names; the view owns the lists themselves. */
  readonly docsCount: number
  readonly decisionsCount: number
  readonly t: TeamConversationProps['t']
}

/**
 * One group of rows: a heading that toggles it, the rows under it. The
 * heading is a real button with `aria-expanded`, so a reader who cannot see
 * the chevron still hears whether the group is open.
 */
function PropSection({ title, defaultOpen = false, children }: { readonly title: string; readonly defaultOpen?: boolean; readonly children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={css.propSection}>
      <h3 className={css.propSectionHead}>
        <button type="button" className={css.propSectionToggle} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <IconChevronRightOutlineRegular size={14} className={css.propSectionChevron} />
          {title}
        </button>
      </h3>
      {open && <div className={css.propRows}>{children}</div>}
    </section>
  )
}

/**
 * The issue's properties: the facts a reader can see and a Human can change.
 * Every value here is the Host's; the client renders it and writes through the
 * Human path.
 */
export function IssueProperties({ properties, members, docsCount, decisionsCount, onStatus, onPriority, onAssignee, pending, t }: IssuePropertiesProps) {
  // The sidebar's relative times, the way the Thread page prints them.
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  const claimHandles = properties.claimOwners.map(owner => members.find(member => member.memberId === owner)?.handle ?? owner)
  return (
    <div className={css.propGroups}>
      <PropSection title={t('propertiesLabel')} defaultOpen>
        <div className={css.propRow} data-testid="issue-prop-status">
          <span className={css.propLabel}>{t('propStatus')}</span>
          <span className={css.propControl}>
            <StatusPicker status={properties.status} onChange={status => { if (!pending) onStatus(status) }} t={t} />
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-priority">
          <span className={css.propLabel}>{t('propPriority')}</span>
          <span className={css.propControl}>
            <PriorityPicker priority={normalizePriority(properties.priority)} onChange={priority => { if (!pending) onPriority(priority) }} t={t} />
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-assignee">
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
      </PropSection>

      <PropSection title={t('propDetails')}>
        <div className={css.propRow}>
          <span className={css.propLabel}>{t('propChannel')}</span>
          <span className={css.propControl} title={properties.channelName}>{properties.channelName}</span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-resolution">
          <span className={css.propLabel}>{t('propResolution')}</span>
          <span className={css.propControl}>{t(RESOLUTION_LABEL_KEY[properties.resolution])}</span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-phase">
          <span className={css.propLabel}>{t('propPhase')}</span>
          <span className={css.propControl} title={t('propPhaseHint')}>
            {properties.planningPhase ? t('propPhasePlanning') : t('propPhaseActive')}
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-claims">
          <span className={css.propLabel}>{t('claims')}</span>
          <span className={css.propControl} title={claimHandles.join(', ')}>
            {claimHandles.length === 0 ? t('noClaims') : claimHandles.map(handle => `@${handle}`).join(', ')}
          </span>
        </div>
      </PropSection>

      <PropSection title={t('propRelated')}>
        <div className={css.propRow} data-testid="issue-prop-docs">
          <span className={css.propLabel}>{t('docsLabel')}</span>
          <span className={css.propControl}>{String(docsCount)}</span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-decisions">
          <span className={css.propLabel}>{t('issueDecisionsLabel')}</span>
          <span className={css.propControl}>{String(decisionsCount)}</span>
        </div>
      </PropSection>
    </div>
  )
}
