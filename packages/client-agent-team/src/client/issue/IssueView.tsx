// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue detail is one component with a `page` and
// a `peek` variant; here the seven regions are a tree of their own and the
// presentation is the host's business. The tree is props-only: data in through
// props, changes out through callbacks, never a context. M-38's slice chrome
// renders this same tree, so a region exists once.

import { useState } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamIssueView, AgentTeamMemberId, AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskStatus } from '../multica/types.ts'
import type { TeamConversationProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { IssueHeader } from './IssueHeader.tsx'
import { IssueDescription } from './IssueDescription.tsx'
import { IssueProperties } from './IssueProperties.tsx'
import { IssueComments, type IssueCommentWrite } from './IssueComments.tsx'
import { IssueActivity } from './IssueActivity.tsx'
import { IssueDecisions } from './IssueDecisions.tsx'
import { IssueExecutionLog, type IssueExecutionLogProps } from './IssueExecutionLog.tsx'
import css from './issue-view.module.css'

export interface IssueViewProps {
  /** The Host's read model for one issue: the seven regions in one snapshot. */
  readonly view: AgentTeamIssueView
  /** The seats the issue names: the roster the pickers and the log draw. */
  readonly members: readonly AgentTeamClientMemberStatus[]
  /** The display name of one Member. */
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  /** The reading Human's Member id, when the Host named one. */
  readonly humanMemberId?: AgentTeamMemberId | undefined
  /** The Human's display name, for a mention that names the Human. */
  readonly humanName: string
  /** Every seat's handle, so a mention names the person it names. */
  readonly mentionHandles: ReadonlyMap<AgentTeamMemberId, string>
  /** Commits a new title; resolves with the failure message, or undefined. */
  readonly onRename: (title: string) => Promise<string | undefined>
  /** Moves the Task's status. */
  readonly onStatus: (status: TaskStatus) => void
  /** Moves the Task's priority. */
  readonly onPriority: (priority: AgentTeamTaskPriority) => void
  /** Assigns the Task, or clears the assignment with null. */
  readonly onAssignee: (memberId: AgentTeamMemberId | null) => void
  /** Reads the page of older comments. */
  readonly onLoadOlderComments: () => void
  readonly loadingOlderComments: boolean
  /** The comment region's write seams: the reply, the attachments, the draft. */
  readonly commentWrite: IssueCommentWrite
  /** Answers an open ask card. */
  readonly onAnswerDecision: (decision: AgentTeamDecisionView, answers: readonly AgentTeamDecisionAnswer[]) => Promise<string | undefined>
  /** The remotes the execution log reads: the Thread's runs, the live row, Stop. */
  readonly execution: IssueExecutionLogProps
  /** A write is in flight; the pickers and the editor wait for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's seven regions: the header, the description, the properties, the
 * comment thread, the activity, the decisions and the execution log. The
 * regions are laid out in that order, and every value in them is the Host's.
 */
export function IssueView({ view, members, nameOf, humanMemberId, humanName, mentionHandles, onRename, onStatus, onPriority, onAssignee, onLoadOlderComments, loadingOlderComments, commentWrite, onAnswerDecision, execution, pending, t }: IssueViewProps) {
  // Under the narrow width the property column folds into a dsh Modal, the
  // way the Thread page folds its sidebar. The column is hidden by the
  // stylesheet there and the opener appears; the Modal carries the same
  // region, so the properties are the same facts either way.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const assigneeOptions = members.map(status => ({
    memberId: status.member.memberId,
    handle: status.member.handle,
  }))
  const properties = (
    <IssueProperties
      properties={view.properties}
      members={assigneeOptions}
      onStatus={onStatus}
      onPriority={onPriority}
      onAssignee={onAssignee}
      pending={pending}
      t={t}
    />
  )
  return (
    <div className={css.page} data-team-issue-view>
      <IssueHeader
        title={view.title}
        taskNumber={view.properties.taskNumber}
        status={view.properties.status}
        channelName={view.properties.channelName}
        onRename={onRename}
        pending={pending}
        t={t}
      />
      <button type="button" className={css.sheetOpener} onClick={() => { setPropertiesOpen(true) }}>
        {t('issuePropertiesOpen')}
      </button>
      <div className={css.bodyRow}>
        <div className={css.content}>
          <IssueDescription description={view.description} authorName={nameOf(view.description.author)} t={t} />
          <IssueComments
            comments={view.comments}
            decisions={view.decisions}
            nameOf={nameOf}
            humanMemberId={humanMemberId}
            humanName={humanName}
            mentionHandles={mentionHandles}
            onLoadOlder={onLoadOlderComments}
            loadingOlder={loadingOlderComments}
            members={members}
            {...commentWrite}
            t={t}
          />
          <IssueActivity activity={view.activity} nameOf={nameOf} t={t} />
          <IssueDecisions decisions={view.decisions} nameOf={nameOf} onAnswer={onAnswerDecision} t={t} />
          <IssueExecutionLog {...execution} />
        </div>
        <aside className={css.side} data-team-issue-side>
          {properties}
        </aside>
      </div>
      <Modal
        open={propertiesOpen}
        onClose={() => { setPropertiesOpen(false) }}
        title={t('propertiesLabel')}
        closeLabel={t('close')}
        contentClassName={`${css.modalBody} ${look.multicaLook}`}
      >
        {properties}
      </Modal>
    </div>
  )
}
