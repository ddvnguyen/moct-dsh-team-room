// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue detail is one component with a `page` and
// a `peek` variant; here the seven regions are a tree of their own and the
// presentation is the host's business. The tree is props-only: data in through
// props, changes out through callbacks, never a context. M-38's slice chrome
// renders this same tree, so a region exists once.

import { useCallback, useMemo, useState } from 'react'
import type { AgentTeamChannelRef, AgentTeamClientMemberStatus, AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamIssueComment, AgentTeamIssueView, AgentTeamMemberId, AgentTeamMessageRef, AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskStatus } from '../multica/types.ts'
import type { TeamConversationProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { IssueHeader } from './IssueHeader.tsx'
import { IssueDescription } from './IssueDescription.tsx'
import { IssueProperties } from './IssueProperties.tsx'
import { IssueTimeline, type IssueCommentWrite } from './IssueTimeline.tsx'
import { IssueComposer } from './IssueComposer.tsx'
import { IssueDecisions } from './IssueDecisions.tsx'
import { IssueExecutionLog, type IssueExecutionLogProps } from './IssueExecutionLog.tsx'
import { mergeComments, quoteResolver } from './comment-thread.ts'
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
  /**
   * Commits the description body against the revision the edit started from.
   * Resolves with the failure message — a stale fence among them — or
   * undefined when the Host took the write.
   */
  readonly patchDescription: (body: string, baseDescriptionRevision: number) => Promise<string | undefined>
  /** Opens the Task's Thread, the legacy surface (D10); absent when there is no way out. */
  readonly onOpenLegacyThread?: (() => void) | undefined
  /**
   * Navigates back to the Channel the header's crumb names; absent renders
   * the crumb's channel as plain text.
   */
  readonly onOpenChannel?: ((channelRef: AgentTeamChannelRef) => void) | undefined
  /**
   * The page's chrome: the reader goes back to the slice and closes the issue
   * from the header. The slice owns its own icon bar, so it passes none of
   * these — a control exists once per presentation.
   */
  readonly onBackToPanel?: (() => void) | undefined
  readonly onCloseIssue?: (() => void) | undefined
  /**
   * The shell column's own state: the header offers the reopen control while
   * the column is closed. Presentation only — the issue never reads the shell.
   */
  readonly sidebarCollapsed?: boolean | undefined
  readonly openSidebar?: (() => void) | undefined
  /**
   * Which presentation hosts this tree: the whole-column page, or the slice
   * dialog over the reader's screen. The variant is presentation only — the
   * page carries the sidebar (properties and the execution-log section), and
   * the slice has no sidebar, so the log section renders only on the page.
   */
  readonly variant: 'page' | 'slice'
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
 * The issue's regions: the header, the description, the properties, the one
 * timeline (comments, runs and grouped activity in instant order), the
 * decisions and the execution log. The regions are laid out in that order, and
 * every value in them is the Host's.
 */
export function IssueView({ view, members, nameOf, humanMemberId, humanName, mentionHandles, onRename, patchDescription, onOpenLegacyThread, onOpenChannel, onBackToPanel, onCloseIssue, sidebarCollapsed, openSidebar, variant, onStatus, onPriority, onAssignee, onLoadOlderComments, loadingOlderComments, commentWrite, onAnswerDecision, execution, pending, t }: IssueViewProps) {
  // Under the narrow width the property column folds into a dsh Modal, the
  // way the Thread page folds its sidebar. The column is hidden by the
  // stylesheet there and the opener appears; the Modal carries the same
  // region, so the properties are the same facts either way.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  // The two facts that cross the column: the rows committed since the last
  // read (the timeline shows them) and the message being answered (the
  // composer shows its quote). The region reads both; neither is a second copy
  // of the Task's comments — `facts` is the one merge of the read model's page
  // and the commits, and it is the list every region in the column reads.
  const [posted, setPosted] = useState<readonly AgentTeamIssueComment[]>([])
  const [replyTarget, setReplyTarget] = useState<AgentTeamMessageRef | undefined>(undefined)
  const facts = useMemo(() => mergeComments([...posted, ...view.comments.items]), [posted, view.comments.items])
  const factByRef = useMemo(() => new Map(facts.map(fact => [fact.message.messageRef, fact])), [facts])
  // The quote a reply shows: one resolver for the cards and the composer, so
  // a reply never quotes a different message than the card it started from.
  const quoteOf = useMemo(() => quoteResolver(factByRef, nameOf), [factByRef, nameOf])
  const onPosted = useCallback((fact: AgentTeamIssueComment): void => { setPosted(current => [...current, fact]) }, [])
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
      docsCount={view.docs.length}
      decisionsCount={view.decisions.length}
      t={t}
    />
  )
  // The execution-log section is the page sidebar's own: it rides the column
  // and the narrow-width drawer, and the slice — which has no sidebar —
  // renders no log at all.
  const log = variant === 'page' ? <IssueExecutionLog {...execution} /> : null
  return (
    <div className={css.page} data-team-issue-view>
      <IssueHeader
        title={view.title}
        taskNumber={view.properties.taskNumber}
        status={view.properties.status}
        channelName={view.properties.channelName}
        channelRef={view.properties.channelRef}
        onOpenChannel={onOpenChannel}
        onRename={onRename}
        // The Thread control lives in the header on the page and in the
        // slice's icon bar; both are the same `goToThread`, so the header
        // renders it only where the bar is not.
        onOpenLegacyThread={variant === 'page' ? onOpenLegacyThread : undefined}
        onBackToPanel={variant === 'page' ? onBackToPanel : undefined}
        onClose={variant === 'page' ? onCloseIssue : undefined}
        sidebarCollapsed={variant === 'page' ? sidebarCollapsed : undefined}
        openSidebar={variant === 'page' ? openSidebar : undefined}
        actions={{
          taskRef: view.task.taskRef,
          status: view.properties.status,
          priority: view.properties.priority,
          assignee: view.properties.assignee,
          members: assigneeOptions,
          onStatus,
          onPriority,
          onAssignee,
          pending,
          t,
        }}
        pending={pending}
        t={t}
      />
      <button type="button" className={css.sheetOpener} onClick={() => { setPropertiesOpen(true) }}>
        {t('issuePropertiesOpen')}
      </button>
      <div className={css.bodyRow}>
        <div className={css.main}>
          <div className={css.content}>
            <IssueDescription description={view.description} authorName={nameOf(view.description.author)} patchDescription={patchDescription} pending={pending} t={t} />
            <IssueTimeline
              comments={view.comments}
              facts={facts}
              activity={view.activity}
              runs={view.executionLog.sessions}
              failures={view.executionLog.failures}
              decisions={view.decisions}
              nameOf={nameOf}
              humanMemberId={humanMemberId}
              humanName={humanName}
              mentionHandles={mentionHandles}
              workspaceId={commentWrite.workspaceId}
              taskRef={commentWrite.taskRef}
              baseRevision={commentWrite.baseRevision}
              resolveComment={commentWrite.resolveComment}
              getAttachment={commentWrite.getAttachment}
              resolveMessageRefs={commentWrite.resolveMessageRefs}
              quoteOf={quoteOf}
              onReply={setReplyTarget}
              onLoadOlder={onLoadOlderComments}
              loadingOlder={loadingOlderComments}
              members={members}
              openMemberSession={execution.openMemberSession}
              variant={variant}
              t={t}
            />
            <IssueDecisions decisions={view.decisions} nameOf={nameOf} onAnswer={onAnswerDecision} t={t} />
          </div>
          {/* The composer is the column's own furniture: it pins under the
              scrolling regions, so the last row can never hide behind it and
              the reader can answer without losing their place. */}
          <div className={css.composerDock} data-issue-composer="">
            <IssueComposer
              {...commentWrite}
              members={members}
              humanMemberId={humanMemberId}
              replyTarget={replyTarget}
              onReplyTarget={setReplyTarget}
              replyQuote={replyTarget === undefined ? undefined : quoteOf(replyTarget)}
              onPosted={onPosted}
              t={t}
            />
          </div>
        </div>
        <aside className={css.side} data-team-issue-side data-testid="issue-properties">
          {properties}
          {log}
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
        {log}
      </Modal>
    </div>
  )
}
