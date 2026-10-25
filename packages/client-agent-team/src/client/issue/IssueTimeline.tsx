// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue body is one chronological list —
// comments, agent runs and grouped activity in one `TimelineItem` array
// (`:572`, `:590–604`). The Team Room used to render `IssueComments` and then
// `IssueActivity` as two regions, so an activity that happened between two
// comments could not sit between them. This is that one region: the merge is
// `timeline.ts`'s pure function, the rows are the same comment cards, one
// expandable activity group, and one run row per Session.
//
// The Host's bounds still govern: the comment page is `commentLimit`, the
// activity region is the newest fifty, and both `hasMore` flags decide the
// tail. The timeline never reads older history on its own.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAttachmentId, AgentTeamClientMemberStatus, AgentTeamIssueActivity, AgentTeamIssueComment, AgentTeamIssueComments,
  AgentTeamIssueDecision, AgentTeamMemberId, AgentTeamMessageRef, AgentTeamTaskRef, AgentTeamThreadSessionRuns,
  AgentTeamThreadTurnFailure,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { TeamComposer } from '../TeamComposer.tsx'
import { CommentCard, type CommentCardReply } from '../multica/comment-card.tsx'
import { buildCommentThread, committedCommentFact, decisionAskMessageRefs } from './comment-thread.ts'
import { mentionedMemberIds, mentionNamesOf, type MentionHandle } from '../team-formatters.ts'
import { mintRequestId, uploadComposerFiles } from '../requests.ts'
import { cachedResolvedMessageRef, hostMessageRefLookup, resolveUnknownMessageRefs, useResolvedMessageRefVersion } from '../refs.ts'
import type { TeamDraftKey, TeamDraftStore } from '../drafts.ts'
import type { TeamConversationProps } from '../slots.ts'
import { issueShareHref } from '../history.ts'
import { useTickingNow } from '../thread/ExecutionLog.tsx'
import { buildTimeline, commentWindowStart, timelineRuns } from './timeline.ts'
import { IssueActivityGroup } from './IssueActivityGroup.tsx'
import { IssueRunRow } from './IssueRunRow.tsx'
import css from './issue-timeline.module.css'

/** The query parameter a copied comment link carries. */
const COMMENT_QUERY_KEY = 'comment'

/**
 * The seams the timeline writes through: the reply, the attachments, the
 * quote resolution and the composer. They are one bundle because the page owns
 * them and the region borrows them — the region never reads a context.
 */
export interface IssueCommentWrite {
  /** The Workspace the issue belongs to: the write and the reads address it. */
  readonly workspaceId: WorkspaceId
  /** The Task the comments belong to: the write addresses it. */
  readonly taskRef: AgentTeamTaskRef
  /** The Host's fence for the comment write: the Thread revision the snapshot carried. */
  readonly baseRevision: number
  /** The write: one comment on the issue. */
  readonly reply: TeamConversationProps['reply']
  readonly putAttachment?: TeamConversationProps['putAttachment'] | undefined
  readonly getAttachment?: TeamConversationProps['getAttachment'] | undefined
  /** Quote context for the replies whose parent is not on screen. */
  readonly resolveMessageRefs?: TeamConversationProps['resolveMessageRefs'] | undefined
  readonly drafts: TeamDraftStore
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  readonly draftKey: TeamDraftKey
}

export interface IssueTimelineProps extends IssueCommentWrite {
  /** The Host's comment region: the Messages, oldest first, the anchor excluded. */
  readonly comments: AgentTeamIssueComments
  /** The Host's activity region: the newest fifty, oldest first, ordering key attached. */
  readonly activity: AgentTeamIssueActivity
  /** The Thread's Session runs, one per seat, the live one included. */
  readonly runs: readonly AgentTeamThreadSessionRuns[]
  /** The Thread's errored Turns: a run with one reads as failed. */
  readonly failures: readonly AgentTeamThreadTurnFailure[]
  /** The decision region: the rows that own the ask messages, so the list skips them. */
  readonly decisions: readonly AgentTeamIssueDecision[]
  /** The display name of one Member. */
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  /** The reading Human's Member id, when the Host named one; their rows read as literal text. */
  readonly humanMemberId?: AgentTeamMemberId | undefined
  /** The Human's display name, for a mention that names the Human. */
  readonly humanName: string
  /** Every seat's handle, so a mention names the person it names. */
  readonly mentionHandles: ReadonlyMap<AgentTeamMemberId, string>
  /** Reads the page of older comments; the Host pages by `comments.cursor`. */
  readonly onLoadOlder: () => void
  readonly loadingOlder: boolean
  /** The seats the composer names. */
  readonly members: readonly AgentTeamClientMemberStatus[]
  /** Opens one run's native dsh session: the same seam the execution log uses. */
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  /** The presentation the copy-link names, so the copied URL reopens the same way. */
  readonly variant: 'page' | 'slice'
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's one chronological list: the Task's comments with their replies,
 * runs of consecutive activity folded into one expandable block, and the
 * Thread's Session runs — all in instant order, with the composer the Human
 * answers in.
 *
 * Every value is the Host's. The region keeps no second copy of the Task's
 * comments, re-derives no order the projection dropped, and writes only
 * through the seams it is given.
 */
export function IssueTimeline({
  comments, activity, runs, failures, decisions, nameOf, humanMemberId, humanName, mentionHandles, workspaceId, taskRef, baseRevision,
  onLoadOlder, loadingOlder, members, openMemberSession, variant, reply, putAttachment, getAttachment, resolveMessageRefs, drafts,
  loadTriggerCatalog, draftKey, t,
}: IssueTimelineProps) {
  const [posted, setPosted] = useState<readonly AgentTeamIssueComment[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined)
  const [replyTarget, setReplyTarget] = useState<AgentTeamMessageRef | undefined>(undefined)
  const [files, setFiles] = useState<readonly File[]>([])
  const [copied, setCopied] = useState<AgentTeamMessageRef | undefined>(undefined)

  // The link a reader arrived on, read once: the timeline scrolls that card
  // into view. A ref that is not in the rendered window is a no-op.
  const [anchor] = useState<AgentTeamMessageRef | null>(() => {
    if (typeof location === 'undefined') return null
    const value = new URLSearchParams(location.search).get(COMMENT_QUERY_KEY)
    return value === null || value === '' ? null : value as AgentTeamMessageRef
  })
  const anchorNode = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = anchorNode.current
    if (node === null || typeof node.scrollIntoView !== 'function') return
    node.scrollIntoView({ block: 'center' })
  }, [])

  const askRefs = useMemo(() => decisionAskMessageRefs(decisions), [decisions])
  // One list: the region the Host carried and the rows this surface committed
  // since. A message present in both is one row.
  const facts = useMemo(() => mergeComments([...comments.items, ...posted]), [comments.items, posted])
  const tree = useMemo(() => buildCommentThread(facts, askRefs), [facts, askRefs])

  // The one timeline: roots only (a reply never splits a root from its answer),
  // and the window starts where the comment page starts when the Host holds more.
  const windowStart = useMemo(() => commentWindowStart(comments), [comments])
  const rows = useMemo(() => buildTimeline({
    comments: tree.roots.map(root => root.fact),
    activity: activity.items,
    runs: timelineRuns(runs),
    windowStart,
  }), [tree, activity.items, runs, windowStart])

  const anyRunning = useMemo(() => rows.some(row => row.kind === 'run' && row.running), [rows])
  const now = useTickingNow(anyRunning)
  const failedSessions = useMemo(() => new Set(failures.map(failure => failure.sessionId)), [failures])
  const handleByMember = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])

  // The quote of the message a reply answers: the loaded fact when it is on
  // screen, the Host's resolution when it is not.
  const factByRef = useMemo(() => new Map(facts.map(fact => [fact.message.messageRef, fact])), [facts])
  const quoteOf = useCallback((messageRef: AgentTeamMessageRef): { readonly senderName: string; readonly excerpt: string } | undefined => {
    const fact = factByRef.get(messageRef)
    if (fact !== undefined) return { senderName: nameOf(fact.message.sender), excerpt: excerptOf(fact.message.body) }
    const resolved = cachedResolvedMessageRef(messageRef)
    return resolved === undefined ? undefined : { senderName: nameOf(resolved.sender), excerpt: resolved.excerpt }
  }, [factByRef, nameOf])

  // Parents that are not on screen still answer: the Host resolves them, and
  // the quote fills in when it lands.
  const messageRefVersion = useResolvedMessageRefVersion()
  useEffect(() => {
    if (resolveMessageRefs === undefined) return
    const missing = [...new Set(facts.flatMap(fact => fact.message.replyToMessageRef === undefined ? [] : [fact.message.replyToMessageRef]))]
      .filter(ref => factByRef.get(ref) === undefined && cachedResolvedMessageRef(ref) === undefined)
    if (missing.length === 0) return
    void resolveUnknownMessageRefs(missing, hostMessageRefLookup(resolveMessageRefs, workspaceId))
  }, [facts, factByRef, resolveMessageRefs, workspaceId, messageRefVersion])

  const mentionNamesOfFact = useCallback((fact: AgentTeamIssueComment): readonly MentionHandle[] =>
    mentionNamesOf(fact.mentions, mentionHandles, humanName), [mentionHandles, humanName])

  const repliesOf = useCallback((root: AgentTeamIssueComment): readonly CommentCardReply[] => {
    const node = tree.roots.find(candidate => candidate.fact.message.messageRef === root.message.messageRef)
    if (node === undefined) return []
    return node.replies.map(reply => ({
      messageRef: reply.fact.message.messageRef,
      author: { name: nameOf(reply.fact.message.sender), kind: reply.fact.message.sender === humanMemberId ? 'human' : 'agent' },
      body: reply.fact.message.body,
      human: reply.fact.message.sender === humanMemberId,
      occurredAt: reply.fact.message.occurredAt,
      mentionNames: mentionNamesOfFact(reply.fact),
      attachments: reply.fact.message.attachments,
      ...(reply.fact.message.replyToMessageRef === undefined ? {} : { replyTo: quoteOf(reply.fact.message.replyToMessageRef) }),
    }))
  }, [tree, nameOf, humanMemberId, mentionNamesOfFact, quoteOf])

  // The copied link is the history module's own URL plus the comment it names:
  // one builder, so the link a reader copies cannot drift from the issue URL.
  const copyLink = useCallback((messageRef: AgentTeamMessageRef): void => {
    if (typeof location === 'undefined' || typeof navigator === 'undefined' || navigator.clipboard === undefined) return
    const url = new URL(issueShareHref(taskRef, variant), location.href)
    url.searchParams.set(COMMENT_QUERY_KEY, messageRef)
    void navigator.clipboard.writeText(url.href).then(() => { setCopied(messageRef) }).catch(() => { setCopied(undefined) })
  }, [taskRef, variant])
  useEffect(() => {
    if (copied === undefined) return
    const timer = setTimeout(() => { setCopied(undefined) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copied])

  const send = useCallback(async (): Promise<void> => {
    const { draft, recipients } = drafts.getSnapshot(draftKey)
    if (pending || draft.trim() === '') return
    setPending(true)
    setError(undefined)
    try {
      let attachmentIds: readonly AgentTeamAttachmentId[] = []
      if (files.length > 0) {
        if (putAttachment === undefined) { setError(t('issueCommentAttachmentUnavailable')); return }
        const upload = await uploadComposerFiles(putAttachment, workspaceId, files)
        if (!upload.ok) { setError(upload.error); return }
        attachmentIds = upload.attachmentIds
      }
      const result = await reply({
        requestId: mintRequestId(),
        workspaceId,
        taskRef,
        body: draft.trim(),
        baseRevision,
        recipients: [...recipients].sort(),
        ...(replyTarget === undefined ? {} : { replyToMessageRef: replyTarget }),
        ...(attachmentIds.length === 0 ? {} : { attachments: attachmentIds }),
      })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        // The write committed: the row appears now, and the change-wake refetch
        // reconciles the list. Nothing was inserted before the commit.
        const committed = result.value
        const mentions = [...new Set([...recipients, ...mentionedMemberIds(draft, members)])].sort()
        setPosted(current => mergeComments([...current, committedCommentFact(committed.message, mentions)]))
        drafts.clear(draftKey)
        setFiles([])
        setReplyTarget(undefined)
        setConfirmation(undefined)
      } else if (result.value.kind === 'confirmation_required') {
        setConfirmation(result.value.confirmationToken)
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
      } else if (result.value.kind === 'stale_revision') {
        setError(t('staleRevision'))
      } else {
        setError(t('issueCommentRejected'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [drafts, draftKey, pending, files, putAttachment, workspaceId, reply, taskRef, baseRevision, replyTarget, members, t])

  const replyParent = replyTarget === undefined ? undefined : quoteOf(replyTarget)
  const replyParentMember = replyTarget === undefined ? undefined : factByRef.get(replyTarget)?.message.sender

  return (
    <section className={css.region} aria-label={t('issueTimelineLabel')} data-issue-timeline="" data-testid="issue-timeline">
      {rows.length === 0
        ? <p className={css.empty} data-issue-timeline-empty="">{t('issueTimelineEmpty')}</p>
        : (
          <div className={css.list} data-issue-timeline-list="">
            {rows.map(row => {
              if (row.kind === 'activity-group') {
                return <IssueActivityGroup key={row.id} facts={row.entries} nameOf={nameOf} t={t} />
              }
              if (row.kind === 'run') {
                return <IssueRunRow
                  key={row.run.sessionId}
                  run={row.run}
                  running={row.running}
                  failed={failedSessions.has(row.run.sessionId)}
                  handle={handleByMember.get(row.run.memberId) ?? nameOf(row.run.memberId)}
                  now={now}
                  onOpenSession={() => { openMemberSession(row.run.sessionId) }}
                  t={t}
                />
              }
              const fact = row.entry
              const messageRef = fact.message.messageRef
              return (
                <div
                  key={messageRef}
                  ref={messageRef === anchor ? anchorNode : undefined}
                  data-message-ref={messageRef}
                  className={messageRef === anchor ? css.anchored : undefined}
                >
                  <CommentCard
                    author={{ name: nameOf(fact.message.sender), kind: fact.message.sender === humanMemberId ? 'human' : 'agent' }}
                    body={fact.message.body}
                    human={fact.message.sender === humanMemberId}
                    occurredAt={fact.message.occurredAt}
                    mentionNames={mentionNamesOfFact(fact)}
                    attachments={fact.message.attachments}
                    {...(getAttachment === undefined ? {} : { loadAttachment: getAttachment })}
                    {...(fact.message.replyToMessageRef === undefined ? {} : { replyTo: quoteOf(fact.message.replyToMessageRef) })}
                    replies={repliesOf(fact)}
                    orphan={tree.roots.find(root => root.fact.message.messageRef === messageRef)?.orphan ?? false}
                    onReply={() => { setReplyTarget(messageRef) }}
                    onCopyLink={() => { copyLink(messageRef) }}
                    linkCopied={copied === messageRef}
                    t={t}
                  />
                </div>
              )
            })}
          </div>
        )}
      {comments.hasMore && (
        <button type="button" className={css.loadOlder} data-issue-timeline-load-older="" disabled={loadingOlder} onClick={onLoadOlder}>
          {loadingOlder ? t('issueCommentsLoading') : t('issueCommentsMore')}
        </button>
      )}
      {activity.hasMore && <p className={css.empty} data-issue-activity-more="">{t('issueActivityMore')}</p>}
      <TeamComposer
        key={draftKey}
        members={members}
        drafts={drafts}
        loadTriggerCatalog={loadTriggerCatalog}
        draftKey={draftKey}
        pending={pending}
        {...(confirmation === undefined ? {} : { confirmation })}
        {...(error === undefined ? {} : { error })}
        onEdit={() => { setConfirmation(undefined); setError(undefined) }}
        onSubmit={() => { void send() }}
        placeholder={t('issueCommentPlaceholder')}
        pendingFiles={files}
        onFilesChange={setFiles}
        {...(replyParent === undefined ? {} : {
          replyTo: {
            ...(replyParentMember === undefined ? {} : { memberId: replyParentMember }),
            senderName: replyParent.senderName,
            excerpt: replyParent.excerpt,
          },
          onCancelReply: () => { setReplyTarget(undefined) },
        })}
        {...(humanMemberId === undefined ? {} : { humanMemberId })}
        t={t}
      />
    </section>
  )
}

/** One list of message facts: a message present twice is one row, oldest first. */
function mergeComments(facts: readonly AgentTeamIssueComment[]): readonly AgentTeamIssueComment[] {
  const byRef = new Map<AgentTeamMessageRef, AgentTeamIssueComment>()
  for (const fact of facts) byRef.set(fact.message.messageRef, fact)
  return [...byRef.values()].sort((left, right) => left.message.sequence - right.message.sequence)
}

/** The gist of one body, for a quote line. */
function excerptOf(body: string): string {
  const firstLine = body.split('\n', 1)[0] ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}
