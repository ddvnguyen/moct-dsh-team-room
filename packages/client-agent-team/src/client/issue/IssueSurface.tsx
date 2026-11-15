// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the shared host of the issue surface — the read, the
// Human's writes, the older-comments page, and the region props. The regions
// themselves live in the shared tree (`IssueView`); the page presentation
// (M-35) and the slice presentation (M-38) are two arrangements of the same
// surface, so the surface lives once: this host reads the value, keeps the
// write state, and hands the tree its props.
//
// The writes are not optimistic: the Remote commits, the change-wake refetches,
// and only then does the field settle. A rejected write leaves the field where
// it was and says why; a stale revision is a business outcome, not an error.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentTeamChannelRef, AgentTeamClientMemberStatus, AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamIssueComment, AgentTeamIssueView, AgentTeamMemberId, AgentTeamTaskPriority, AgentTeamTaskPullRequest, AgentTeamTaskRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskStatus } from '../multica/types.ts'
import { normalizePriority } from '../multica/priority.ts'
import type { TeamConversationProps } from '../slots.ts'
import type { TeamDraftStore } from '../drafts.ts'
import { mintRequestId } from '../requests.ts'
import { IssueView } from './IssueView.tsx'
import type { ParentTaskOption } from './IssueProperties.tsx'
import css from './issue-view.module.css'

export interface IssueSurfaceProps {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  /** The Host's issue read: one snapshot per issue, shared by every presentation. */
  readonly loadIssueView: TeamConversationProps['loadIssueView']
  readonly loadMembers: TeamConversationProps['loadMembers']
  /** The Workspace view: it names the reading Human, whose rows read as literal text. */
  readonly loadChannels: TeamConversationProps['loadChannels']
  /** The reading Human's display name, for a mention that names the Human. */
  readonly humanName: string
  /** The Thread's older facts, for the comment region's next page. */
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  /** The Human's answer on the issue: one comment on the Task. */
  readonly reply: TeamConversationProps['reply']
  /** Closes or reopens one comment thread on the issue; a stale revision is a business outcome. */
  readonly resolveComment: TeamConversationProps['resolveComment']
  /** The attachment write the composer's file pick uploads through. */
  readonly putAttachment?: TeamConversationProps['putAttachment'] | undefined
  readonly getAttachment?: TeamConversationProps['getAttachment'] | undefined
  /** Resolves the parent of a reply whose parent is not on screen. */
  readonly resolveMessageRefs?: TeamConversationProps['resolveMessageRefs'] | undefined
  /** The composer's draft cache; the issue's draft is its own key. */
  readonly drafts: TeamDraftStore
  /** The composer's slash-trigger catalog. */
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  /** The board's field write: title, priority, assignee; fenced by the Thread revision. */
  readonly updateTask: TeamConversationProps['updateTask']
  /**
   * The board's catalog read: the workspace Tasks the parent picker offers.
   * The picker reads the same read the board page issues — no new ledger read.
   */
  readonly loadBoard?: TeamConversationProps['loadBoard'] | undefined
  /**
   * The one seam an issue is opened with: the related rows (the parent and the
   * sub-issues) hand it the Task row, so a click walks the same seam a card
   * does. Presented without a way out (a peek panel) it is absent and the
   * rows render without the seam.
   */
  readonly openIssue?: TeamConversationProps['openIssue'] | undefined
  /** The Task's resolution write: accept, close, reopen; fenced by the Thread revision. */
  readonly changeTask: TeamConversationProps['changeTask']
  /** The Human's answer to one open decision card. */
  readonly answerDecision: TeamConversationProps['answerDecision']
  readonly loadThreadSessions: TeamConversationProps['loadThreadSessions']
  readonly loadMemberActivity: TeamConversationProps['loadMemberActivity']
  readonly threadTurnFailures: TeamConversationProps['threadTurnFailures']
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly stopSession: TeamConversationProps['stopSession']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  /**
   * Opens the Task's Thread — the legacy surface D10 froze — from the issue's
   * own header. The page and the slice both pass it, so the reader never has
   * to leave the issue to find the Thread it replaced.
   */
  readonly onOpenLegacyThread?: (() => void) | undefined
  /** Which presentation hosts the tree: the page or the slice (see `IssueViewProps`). */
  readonly variant: 'page' | 'slice'
  /** Navigates back to the Channel the header's crumb names. */
  readonly onOpenChannel?: ((channelRef: AgentTeamChannelRef) => void) | undefined
  /** The page's own header chrome; the slice passes none of these (see `IssueViewProps`). */
  readonly onBackToPanel?: (() => void) | undefined
  readonly onCloseIssue?: (() => void) | undefined
  readonly sidebarCollapsed?: boolean | undefined
  readonly openSidebar?: (() => void) | undefined
  readonly t: TeamConversationProps['t']
}

/**
 * The issue surface: the seven regions of one issue, read once and written
 * through the Host's own paths. The page and the slice are two arrangements
 * of it — this host is what they share, so a change of arrangement never
 * changes what the reader sees.
 */
export function IssueSurface(props: IssueSurfaceProps) {
  const { workspaceId, taskRef, loadIssueView, loadMembers, loadChannels, humanName, loadThreadHistory, reply, resolveComment, putAttachment, getAttachment, resolveMessageRefs, drafts, loadTriggerCatalog, updateTask, loadBoard, openIssue, changeTask, answerDecision, subscribeChanges, onOpenLegacyThread, variant, onOpenChannel, onBackToPanel, onCloseIssue, sidebarCollapsed, openSidebar, t } = props
  const [view, setView] = useState<AgentTeamIssueView>()
  const [older, setOlder] = useState<readonly AgentTeamIssueComment[]>([])
  const [olderHasMore, setOlderHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  // The workspace Task catalog the parent picker reads, one read per issue
  // open (the same read the board page issues); absent when the host passes
  // no board read.
  const [taskOptions, setTaskOptions] = useState<readonly ParentTaskOption[]>([])
  const [humanMemberId, setHumanMemberId] = useState<AgentTeamMemberId>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // The Thread the issue lives in, once the first read named it: passing it
  // narrows the issue query's covered scopes, so a change on that Thread
  // invalidates the issue value (C5). It is a ref, not state: the read's
  // identity must not change when the Thread is learned.
  const threadScope = useRef<AgentTeamThreadRef>()

  const read = useCallback(async (): Promise<void> => {
    const result = await loadIssueView({ workspaceId, taskRef }, threadScope.current)
    if (!mounted.current) return
    if (result.ok) {
      threadScope.current = result.value.thread.threadRef
      setView(result.value)
      setError(undefined)
      return
    }
    setError(result.error.message)
  }, [loadIssueView, workspaceId, taskRef])

  useEffect(() => {
    setView(undefined)
    setOlder([])
    setOlderHasMore(false)
    void read()
  }, [read])

  // The roster names the seats the issue names; the Workspace view names the
  // reading Human, whose own Messages read as literal text.
  useEffect(() => {
    let live = true
    void (async () => {
      const roster = await loadMembers({ workspaceId }).catch(() => undefined)
      if (!live || roster?.ok !== true) return
      setMembers(roster.value)
      const workspaceView = await loadChannels({ workspaceId }).catch(() => undefined)
      if (!live || workspaceView?.ok !== true) return
      setHumanMemberId(workspaceView.value.humanMemberId)
      if (loadBoard === undefined) return
      const board = await loadBoard({ workspaceId }).catch(() => undefined)
      if (!live || board?.ok !== true) return
      const numbers = new Map(board.value.taskNumbers.map(row => [row.taskRef, row.taskNumber] as const))
      setTaskOptions(board.value.tasks.map(task => ({
        taskRef: task.taskRef,
        taskNumber: numbers.get(task.taskRef) ?? 0,
        ...(task.title === undefined ? {} : { title: task.title }),
        status: task.status,
      })))
    })()
    return () => { live = false }
  }, [loadMembers, loadChannels, workspaceId, loadBoard])

  const threadRef = view?.thread.threadRef

  // The issue's Thread scope and the Workspace scope are the ones that can
  // change it (C5); either wake re-reads the snapshot.
  useEffect(() => {
    if (threadRef === undefined) return undefined
    const disposers = [
      subscribeChanges({ kind: 'thread', threadRef }, update => { if (update.type !== 'failed') void read() }),
      subscribeChanges({ kind: 'workspace', workspaceId }, update => { if (update.type !== 'failed') void read() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, [subscribeChanges, threadRef, workspaceId, read])

  const mentionHandles = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])
  const nameOf = useCallback((memberId: AgentTeamMemberId): string => {
    if (memberId === humanMemberId) return humanName === '' ? memberId : humanName
    return members.find(status => status.member.memberId === memberId)?.member.handle ?? memberId
  }, [members, humanMemberId, humanName])

  /** The Host's fence for a Task write: the Thread revision the snapshot carried. */
  const baseRevision = view?.thread.revision

  const patchTask = useCallback(async (patch: { readonly title?: string; readonly priority?: AgentTeamTaskPriority; readonly assignee?: AgentTeamMemberId | null;
    readonly parentTaskRef?: AgentTeamTaskRef | null; readonly pullRequests?: readonly AgentTeamTaskPullRequest[];
    readonly labels?: readonly string[]; readonly dueDate?: string | null }): Promise<string | undefined> => {
    if (pending || view === undefined || baseRevision === undefined) return undefined
    setPending(true)
    setError(undefined)
    try {
      const result = await updateTask({ requestId: mintRequestId(), workspaceId, taskRef, baseRevision, patch })
      if (!result.ok) { setError(result.error.message); return result.error.message }
      // updateTask's only remaining business outcome is the stale revision:
      // board fields are metadata, so no unread fence applies to them.
      if (result.value.kind === 'stale_revision') {
        setError(t('staleRevision'))
        return t('staleRevision')
      }
      // The Host committed it: the change-wake refetches, and the field settles
      // when the new snapshot arrives. Nothing moves here.
      return undefined
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      return message
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [pending, view, baseRevision, updateTask, workspaceId, taskRef, t])

  /**
   * The description's own write: fenced by the revision the EDIT started from,
   * not the one the save happens to see — otherwise a paragraph written while
   * the editor was open would be overwritten by this one. The Thread's
   * `baseRevision` still rides along as the request's own fence, and a stale
   * fence is a business outcome the caller reports, never an error the editor
   * swallows. Not optimistic: the Host commits, the change-wake refetches, and
   * only then does the record move.
   */
  const patchDescription = useCallback(async (body: string, baseDescriptionRevision: number): Promise<string | undefined> => {
    if (pending || view === undefined || baseRevision === undefined) return undefined
    setPending(true)
    setError(undefined)
    try {
      const result = await updateTask({
        requestId: mintRequestId(),
        workspaceId,
        taskRef,
        baseRevision,
        patch: { description: body, baseDescriptionRevision },
      })
      if (!result.ok) { setError(result.error.message); return result.error.message }
      if (result.value.kind === 'stale_revision') {
        const message = t('staleRevision')
        setError(message)
        return message
      }
      if (result.value.kind === 'stale_description_revision') {
        const message = t('staleDescriptionRevision')
        setError(message)
        return message
      }
      // The Host took it: the change-wake refetches and the record settles
      // there. Nothing moves here.
      return undefined
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      return message
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [pending, view, baseRevision, updateTask, workspaceId, taskRef, t])

  const moveStatus = useCallback((status: TaskStatus): void => {
    if (pending || view === undefined || baseRevision === undefined) return
    const action = status === 'done' ? 'accept' : status === 'closed' ? 'close' : 'reopen'
    setPending(true)
    setError(undefined)
    void (async () => {
      const result = await changeTask({ requestId: mintRequestId(), workspaceId, taskRef, action, baseRevision })
      if (!mounted.current) return
      setPending(false)
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'unread_required') { setError(t('unreadRequired', { count: result.value.unreadCount })); return }
      if (result.value.kind === 'stale_revision') { setError(t('staleRevision')); return }
    })()
  }, [pending, view, baseRevision, changeTask, workspaceId, taskRef, t])

  const loadOlder = useCallback((): void => {
    if (loadingOlder || view === undefined) return
    setLoadingOlder(true)
    void (async () => {
      // The cursor is the merged one: the oldest comment the page carries, the
      // newest page's cursor until an older page lands. The Host's newest page
      // never moves, so reading from it again would fetch the same page twice.
      // The limit is the Thread page's own page size, inside the Host's bound
      // (the ledger refuses anything outside 1–100).
      const result = await loadThreadHistory({ workspaceId, taskRef, beforeSequence: older[0]?.sequence ?? view.comments.cursor, limit: 20 })
      if (!mounted.current) return
      setLoadingOlder(false)
      if (!result.ok) { setError(result.error.message); return }
      // The history read returns the raw facts: the Thread's anchor and the ask
      // of every decision card are in it, and the Host's own issue read leaves
      // both out. The same rule is applied here, so paging back never shows the
      // description a second time or repeats an ask the decisions own.
      const askRefs = new Set(view.decisions.flatMap(row => row.kind === 'card' ? [row.card.messageRef] : row.card === undefined ? [] : [row.card.messageRef]))
      const olderComments = result.value.facts.filter((fact): fact is AgentTeamIssueComment => fact.kind === 'message'
        && fact.message.messageRef !== result.value.anchor.messageRef
        && !askRefs.has(fact.message.messageRef))
      setOlder(current => [...olderComments, ...current])
      setOlderHasMore(result.value.hasMore)
    })()
  }, [loadingOlder, older, view, loadThreadHistory, workspaceId, taskRef])

  const answer = useCallback(async (decision: AgentTeamDecisionView, answers: readonly AgentTeamDecisionAnswer[]): Promise<string | undefined> => {
    const result = await answerDecision({ requestId: mintRequestId(), workspaceId, decisionRef: decision.decisionRef, answers })
    if (!result.ok) return result.error.message
    void read()
    return undefined
  }, [answerDecision, workspaceId, read])

  /**
   * The view the tree draws: the newest page with the older pages in front of
   * it. One snapshot is one value — a render that changed nothing else reuses
   * it, so the comment page's identity means "a read replaced this page" and
   * the timeline can let a fresh read outrank what it wrote itself.
   */
  const shown = useMemo<AgentTeamIssueView | undefined>(() => {
    if (view === undefined) return undefined
    if (older.length === 0) return view
    return {
      ...view,
      comments: {
        ...view.comments,
        items: [...older, ...view.comments.items],
        hasMore: olderHasMore,
        cursor: older[0]?.sequence ?? view.comments.cursor,
      },
    }
  }, [view, older, olderHasMore])

  if (view === undefined || shown === undefined) {
    return (
      <>
        {error !== undefined
          ? <p className={css.error} role="alert">{error}</p>
          : <p className={css.empty}>{t('loadingIssue')}</p>}
        <Button size="sm" variant="outline" onClick={() => { void read() }}>{t('retry')}</Button>
      </>
    )
  }

  return (
    <>
      <IssueView
        view={shown}
        members={members}
        nameOf={nameOf}
        humanMemberId={humanMemberId}
        humanName={humanName}
        mentionHandles={mentionHandles}
        onRename={title => patchTask({ title })}
        patchDescription={patchDescription}
        onOpenLegacyThread={onOpenLegacyThread}
        variant={variant}
        onOpenChannel={onOpenChannel}
        onBackToPanel={onBackToPanel}
        onCloseIssue={onCloseIssue}
        sidebarCollapsed={sidebarCollapsed}
        openSidebar={openSidebar}
        onStatus={moveStatus}
        onPriority={priority => { void patchTask({ priority: normalizePriority(priority) }) }}
        onAssignee={memberId => { void patchTask({ assignee: memberId }) }}
        onParent={taskRef => { void patchTask({ parentTaskRef: taskRef }) }}
        onDueDate={dueDate => { void patchTask({ dueDate }) }}
        onPullRequests={links => { void patchTask({ pullRequests: links }) }}
        onLabels={labels => { void patchTask({ labels }) }}
        tasks={taskOptions}
        taskRef={taskRef}
        openIssue={openIssue}
        onLoadOlderComments={loadOlder}
        loadingOlderComments={loadingOlder}
        commentWrite={{
          workspaceId,
          taskRef,
          baseRevision: view.thread.revision,
          reply,
          resolveComment,
          putAttachment,
          getAttachment,
          resolveMessageRefs,
          drafts,
          loadTriggerCatalog,
          draftKey: `issue:${taskRef}`,
        }}
        onAnswerDecision={answer}
        execution={{
          workspaceId,
          threadRef: view.thread.threadRef,
          loadThreadSessions: props.loadThreadSessions,
          loadMemberActivity: props.loadMemberActivity,
          threadTurnFailures: props.threadTurnFailures,
          openMemberSession: props.openMemberSession,
          stopSession: props.stopSession,
          subscribeChanges: props.subscribeChanges,
          members,
          t,
        }}
        pending={pending}
        t={t}
      />
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </>
  )
}
