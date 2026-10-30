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
import type { AgentTeamIssueProperties, AgentTeamMemberId, AgentTeamTask, AgentTeamTaskPriority, AgentTeamTaskPullRequest, AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'
import { normalizePriority } from '../multica/priority.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { StatusPicker } from '../multica-ui/StatusPicker.tsx'
import { PriorityPicker } from '../multica-ui/PriorityPicker.tsx'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { PickerItem, PickerMenu } from '../multica-ui/PickerMenu.tsx'
import { IconChevronRightOutlineRegular, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
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
  /** Names the Task's parent, or clears it with null; a refusal is the picker's own error row. */
  readonly onParent: (taskRef: AgentTeamTaskRef | null) => void
  /** Sets or clears the due date, `YYYY-MM-DD` local-form input. */
  readonly onDueDate: (dueDate: string | null) => void
  /** Replaces the stored PR links. */
  readonly onPullRequests: (links: readonly AgentTeamTaskPullRequest[]) => void
  /** Replaces the stored labels. */
  readonly onLabels: (labels: readonly string[]) => void
  /** This Task's own ref: the picker must not offer the Task as its parent. */
  readonly taskRef: AgentTeamTaskRef
  /** The Workspace the issue is read in: an open from another Workspace must not land there. */
  readonly workspaceId: WorkspaceId
  /** The workspace Tasks the parent picker offers; absent renders an empty picker. */
  readonly tasks: readonly ParentTaskOption[]
  /** Opens a related Task through the one seam every card uses; absent renders the rows without it. */
  readonly openIssue?: TeamConversationProps['openIssue'] | undefined
  /** A write is in flight; the pickers wait for it. */
  readonly pending: boolean
  /** The counts the Related group names; the view owns the lists themselves. */
  readonly docsCount: number
  readonly decisionsCount: number
  readonly t: TeamConversationProps['t']
}

/**
 * One Task the parent picker offers: the board catalog's row with the number
 * and title resolved on the client, so the picker menu never resolves twice.
 */
export interface ParentTaskOption {
  readonly taskRef: AgentTeamTaskRef
  readonly taskNumber: number
  /** The Task's title, or undefined when the board card falls back to the number. */
  readonly title?: string | undefined
  readonly status: AgentTeamTask['status']
}

/**
 * The parent picker: the workspace Tasks the board's catalog read carries,
 * written through the same seam the other board fields use. The Task itself
 * is out, and a parent the Host refuses (a cycle deeper up the chain) comes
 * back as the surface's error line, never a thrown dialog.
 */
function ParentPicker({ taskRef, parent, tasks, onChange, pending, t }: {
  readonly taskRef: AgentTeamTaskRef
  readonly parent: AgentTeamIssueProperties['parent']
  readonly tasks: readonly ParentTaskOption[]
  readonly onChange: (taskRef: AgentTeamTaskRef | null) => void
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}) {
  const listed = tasks.some(task => task.taskRef === parent?.taskRef)
  return (
    <PickerMenu
      triggerLabel={t('parentPickerLabel')}
      valueLabel={parent === undefined ? t('parentNone') : `#${parent.taskNumber} ${parent.title}`}
      label={parent === undefined ? <span className={css.parentNone}>{t('parentNone')}</span> : <span data-testid="issue-prop-parent-value">{`#${parent.taskNumber} ${parent.title}`}</span>}
    >
      {close => (
        <>
          <PickerItem
            selected={parent === undefined}
            disabled={pending}
            onSelect={() => {
              close()
              if (parent !== undefined) onChange(null)
            }}
          >
            <span className={css.parentNone}>{t('parentNone')}</span>
          </PickerItem>
          {tasks.map(task => {
            const self = task.taskRef === taskRef
            const chosen = task.taskRef === parent?.taskRef
            return (
              <PickerItem
                key={task.taskRef}
                selected={chosen}
                disabled={pending || self}
                describedBy={self ? 'issue-prop-parent-self' : undefined}
                onSelect={() => {
                  close()
                  if (!chosen && !self) onChange(task.taskRef)
                }}
              >
                <span className={css.parentOption} data-testid={`parent-option-${task.taskNumber}`}>
                  {`#${task.taskNumber} ${task.title ?? `#${task.taskNumber}`}`}
                </span>
              </PickerItem>
            )
          })}
          {parent !== undefined && !listed && (
            <PickerItem selected={false} disabled onSelect={() => {}}>
              <span className={css.parentOrphan} title={parent.taskRef}>{`#${parent.taskNumber} ${parent.title}`}</span>
            </PickerItem>
          )}
        </>
      )}
    </PickerMenu>
  )
}

/**
 * The due date: a date input cleared to empty for null, the window tinted
 * while the date is behind today and the Task is not done or closed.
 */
function DueDateControl({ dueDate, status, onChange, pending, t }: {
  readonly dueDate: string | undefined
  readonly status: AgentTeamIssueProperties['status']
  readonly onChange: (dueDate: string | null) => void
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}) {
  const today = localToday()
  const overdue = dueDate !== undefined && dueDate < today && status !== 'done' && status !== 'closed'
  return (
    <input
      className={css.propDue}
      data-testid="issue-prop-date"
      data-overdue={overdue || undefined}
      title={overdue ? t('dueOverdue') : undefined}
      type="date"
      aria-label={t('propDueDate')}
      value={dueDate ?? ''}
      disabled={pending}
      onChange={event => { onChange(event.target.value === '' ? null : event.target.value) }}
    />
  )
}

/** The calendar day one due date compares against, `YYYY-MM-DD`. */
function localToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * The labels: one chip per stored label, each removable, and the add row that
 * replaces the list — the Host trims, bounds and dedupes, the client renders.
 */
function LabelsControl({ labels, onChange, pending, t }: {
  readonly labels: readonly string[]
  readonly onChange: (labels: readonly string[]) => void
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const value = draft.trim()
    if (value === '') return
    setDraft('')
    if (labels.some(label => label.toLowerCase() === value.toLowerCase())) return
    onChange([...labels, value])
  }
  return (
    <span className={css.propLabels} data-testid="issue-prop-labels">
      {labels.map(label => (
        <span className={css.propLabelChip} key={label}>
          <span className={css.propLabelChipText}>{label}</span>
          <button
            type="button"
            className={css.propRemove}
            aria-label={t('labelRemove', { label })}
            disabled={pending}
            onClick={() => { onChange(labels.filter(stored => stored !== label)) }}
          >
            <IconCloseOutlineRegular size={10} />
          </button >
        </span>
      ))}
      <input
        className={css.propLabelAdd}
        aria-label={t('labelsAdd')}
        placeholder={t('labelsAdd')}
        value={draft}
        disabled={pending}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
        onBlur={() => { if (draft.trim() !== '') add() }}
      />
    </span>
  )
}

/**
 * The PR links: one row per stored link, and the add row that appends one.
 * The link is text the browser opens; the Host, not the client, validates it.
 */
function PullRequestsControl({ links, onChange, pending, t }: {
  readonly links: readonly AgentTeamTaskPullRequest[]
  readonly onChange: (links: readonly AgentTeamTaskPullRequest[]) => void
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const url = draft.trim()
    if (url === '') return
    setDraft('')
    if (links.some(link => link.url === url)) return
    onChange([...links, { url }])
  }
  return (
    <span className={css.propPrs} data-testid="issue-prop-prs">
      {links.map(link => (
        <span className={css.propPr} key={link.url}>
          <a className={css.propPrLink} href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.title ?? link.url}</a>
          <button
            type="button"
            className={css.propRemove}
            aria-label={t('prRemove', { title: link.title ?? link.url })}
            disabled={pending}
            onClick={() => { onChange(links.filter(stored => stored.url !== link.url)) }}
          >
            <IconCloseOutlineRegular size={10} />
          </button >
        </span>
      ))}
      <span className={css.propPrAdd}>
        <input
          className={css.propInput}
          aria-label={t('prAdd')}
          placeholder={t('prAdd')}
          value={draft}
          disabled={pending}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
          onBlur={() => { if (draft.trim() !== '') add() }}
        />
      </span>
    </span>
  )
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
export function IssueProperties({ properties, workspaceId, members, docsCount, decisionsCount, onStatus, onPriority, onAssignee, onParent, onDueDate, onPullRequests, onLabels, taskRef, tasks, openIssue, pending, t }: IssuePropertiesProps) {
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
        <div className={css.propRow} data-testid="issue-prop-parent">
          <span className={css.propLabel}>{t('propParent')}</span>
          <span className={css.propControl}>
            <ParentPicker taskRef={taskRef} parent={properties.parent} tasks={tasks} onChange={option => { if (!pending) onParent(option) }} pending={pending} t={t} />
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-due">
          <span className={css.propLabel}>{t('propDueDate')}</span>
          <span className={css.propControl}>
            <DueDateControl dueDate={properties.dueDate} status={properties.status} onChange={dueDate => { if (!pending) onDueDate(dueDate) }} pending={pending} t={t} />
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-labels-row">
          <span className={css.propLabel}>{t('propLabels')}</span>
          <span className={`${css.propControl} ${css.propRelative}`}>
            <LabelsControl labels={properties.labels} onChange={labels => { if (!pending) onLabels(labels) }} pending={pending} t={t} />
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
        <div className={css.propRow} data-testid="issue-prop-subissues">
          <span className={css.propLabel}>{t('propSubIssues')}</span>
          <span className={`${css.propControl} ${css.propRelative}`}>
            {properties.subIssues.length === 0
              ? <span className={css.parentNone}>{t('propSubIssuesNone')}</span>
              : properties.subIssues.map(row => (
                <button
                  key={row.taskRef}
                  type="button"
                  className={css.parentOption}
                  title={row.title}
                  disabled={openIssue === undefined}
                  onClick={event => {
                    const target = event.currentTarget
                    openIssue?.(row.taskRef, { workspaceId, focusOpener: () => { target.focus({ preventScroll: true }) } })
                  }}
                >
                  {`#${row.taskNumber} ${row.title}`}
                </button>
              ))}
          </span>
        </div>
        <div className={css.propRow} data-testid="issue-prop-related-prs">
          <span className={css.propLabel}>{t('propPullRequests')}</span>
          <span className={`${css.propControl} ${css.propRelative}`}>
            <PullRequestsControl links={properties.pullRequests} onChange={links => { if (!pending) onPullRequests(links) }} pending={pending} t={t} />
          </span>
        </div>
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
