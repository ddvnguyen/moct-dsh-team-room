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
  AgentTeamClientMemberStatus, AgentTeamCommentResolution, AgentTeamIssueActivity, AgentTeamIssueComment, AgentTeamIssueComments,
  AgentTeamIssueDecision, AgentTeamMemberId, AgentTeamMessageRef, AgentTeamTaskRef, AgentTeamThreadSessionRuns,
  AgentTeamThreadTurnFailure,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { CommentCard, ResolvedThreadBar, type CommentCardReply } from '../multica/comment-card.tsx'
import { buildCommentThread, decisionAskMessageRefs } from './comment-thread.ts'
import { mentionNamesOf, type MentionHandle } from '../team-formatters.ts'
import { mintRequestId } from '../requests.ts'
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

/** The Host's answer to one resolve / reopen: `null` is "reopened". */
type ResolvedAnswer = AgentTeamCommentResolution | null

/** No answer at all, one shared empty map so a fresh view is not a new object. */
const NO_ANSWERS: ReadonlyMap<AgentTeamMessageRef, ResolvedAnswer> = new Map()

/**
 * The answers this page wrote, and the comment page they were written against.
 *
 * The page is the whole of their life: an answer bridges the gap between the
 * commit and the read that carries it, and a different page — a fresh view —
 * is the Host's own snapshot, which already answers every thread it carries.
 */
interface ResolvedAnswers {
  readonly page: readonly AgentTeamIssueComment[]
  readonly answers: ReadonlyMap<AgentTeamMessageRef, ResolvedAnswer>
}

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
  /** The write: close or reopen one comment thread; the card's value moves when the Host answers. */
  readonly resolveComment: TeamConversationProps['resolveComment']
  readonly putAttachment?: TeamConversationProps['putAttachment'] | undefined
  readonly getAttachment?: TeamConversationProps['getAttachment'] | undefined
  /** Quote context for the replies whose parent is not on screen. */
  readonly resolveMessageRefs?: TeamConversationProps['resolveMessageRefs'] | undefined
  readonly drafts: TeamDraftStore
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  readonly draftKey: TeamDraftKey
}

export interface IssueTimelineProps extends Pick<IssueCommentWrite, 'workspaceId' | 'taskRef' | 'baseRevision' | 'resolveComment' | 'getAttachment' | 'resolveMessageRefs'> {
  /** The Host's comment region: the Messages, oldest first, the anchor excluded. */
  readonly comments: AgentTeamIssueComments
  /**
   * The rows this surface renders: the read model's page merged with the rows
   * committed since, resolved once by the view that owns both — the region
   * keeps no list of its own.
   */
  readonly facts: readonly AgentTeamIssueComment[]
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
  /** The quote a reply shows, resolved against the facts the view owns. */
  readonly quoteOf: (messageRef: AgentTeamMessageRef) => { readonly senderName: string; readonly excerpt: string; readonly memberId?: AgentTeamMemberId | undefined } | undefined
  /** The reply buttons write the target here; the composer reads it back from the view. */
  readonly onReply: (messageRef: AgentTeamMessageRef) => void
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
  comments, facts, activity, runs, failures, decisions, nameOf, humanMemberId, humanName, mentionHandles, workspaceId, taskRef, baseRevision,
  quoteOf, onReply: markReply, onLoadOlder, loadingOlder, members, openMemberSession, variant, resolveComment, getAttachment, resolveMessageRefs, t,
}: IssueTimelineProps) {
  const [copied, setCopied] = useState<AgentTeamMessageRef | undefined>(undefined)
  // The Host's own answers to a resolve / reopen. The value moves here only
  // after the write commits, so nothing is guessed — a refused write leaves the
  // card exactly as the Host still reads it — and it bridges only the page it
  // was written against: once a fresh read replaces that page, the Host's own
  // snapshot decides, so a thread reopened or re-resolved elsewhere stops
  // being stale here without waiting for a remount.
  const [answered, setAnswered] = useState<ResolvedAnswers>({ page: comments.items, answers: NO_ANSWERS })
  const resolvedAnswers = answered.page === comments.items ? answered.answers : NO_ANSWERS
  const [resolving, setResolving] = useState<AgentTeamMessageRef | undefined>(undefined)
  const [resolveErrors, setResolveErrors] = useState<ReadonlyMap<AgentTeamMessageRef, string>>(new Map())

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
  // One list, resolved by the view: the region's rows arrive merged, so this
  // region never keeps a second copy of the Task's comments.
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

  // The facts, resolved by the view: the region reads the same list the
  // composer's quote reads, so a reply never quotes a different message than
  // the card it was started from.
  const factByRef = useMemo(() => new Map(facts.map(fact => [fact.message.messageRef, fact])), [facts])

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

  /**
   * The thread's resolution: the answer this page wrote, while the page it was
   * written against is still on screen, and otherwise the value the view
   * carries. The view is what reconciles the two — it outranks an answer as
   * soon as it is a newer read.
   */
  const resolutionOf = useCallback((fact: AgentTeamIssueComment): AgentTeamCommentResolution | undefined => {
    if (resolvedAnswers.has(fact.message.messageRef)) return resolvedAnswers.get(fact.message.messageRef) ?? undefined
    return fact.resolved
  }, [resolvedAnswers])

  const reportResolveError = useCallback((messageRef: AgentTeamMessageRef, reason: string): void => {
    setResolveErrors(current => new Map(current).set(messageRef, t('issueCommentResolvedFailed', { reason })))
  }, [t])

  /**
   * One resolve / reopen, written through the Host and read back from its
   * answer. Nothing is shown before the commit: a refused write leaves the
   * thread exactly as it was and says why. The fence is the Thread revision
   * the region reads — the composer's write owns the same one, and neither
   * guesses at it.
   */
  const toggleResolved = useCallback(async (messageRef: AgentTeamMessageRef, resolved: boolean): Promise<void> => {
    if (resolving !== undefined) return
    setResolving(messageRef)
    setResolveErrors(current => {
      if (!current.has(messageRef)) return current
      const next = new Map(current)
      next.delete(messageRef)
      return next
    })
    try {
      const result = await resolveComment({ requestId: mintRequestId(), workspaceId, taskRef, messageRef, resolved, baseRevision })
      if (!result.ok) { reportResolveError(messageRef, result.error.message); return }
      const answer = result.value
      if (answer.kind !== 'committed') { reportResolveError(messageRef, t('staleRevision')); return }
      // One answer for one page: a write against a newer page starts a new
      // map, because that page's own values already answer its other threads.
      setAnswered(current => ({
        page: comments.items,
        answers: new Map(current.page === comments.items ? current.answers : undefined).set(messageRef, answer.resolved ?? null),
      }))
    } catch (cause) {
      reportResolveError(messageRef, cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResolving(undefined)
    }
  }, [resolving, resolveComment, workspaceId, taskRef, baseRevision, comments.items, reportResolveError, t])
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
              const resolution = resolutionOf(fact)
              const resolveError = resolveErrors.get(messageRef)
              const card = (
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
                  {...(resolution === undefined ? {} : { resolved: { by: nameOf(resolution.memberId), at: resolution.resolvedAt } })}
                  onReply={() => { markReply(messageRef) }}
                  onCopyLink={() => { copyLink(messageRef) }}
                  linkCopied={copied === messageRef}
                  {...(resolution === undefined ? { onToggleResolved: () => { void toggleResolved(messageRef, true) } } : {})}
                  resolvePending={resolving === messageRef}
                  {...(resolveError === undefined ? {} : { resolveError })}
                  t={t}
                />
              )
              return (
                <div
                  key={messageRef}
                  ref={messageRef === anchor ? anchorNode : undefined}
                  data-message-ref={messageRef}
                  className={messageRef === anchor ? css.anchored : undefined}
                >
                  {/* A closed thread collapses to one bar; opening it shows
                      the same card an open thread shows. */}
                  {resolution === undefined ? card : (
                    <ResolvedThreadBar
                      resolved={{ by: nameOf(resolution.memberId), at: resolution.resolvedAt }}
                      onReopen={() => { void toggleResolved(messageRef, false) }}
                      reopenPending={resolving === messageRef}
                      reopenError={resolveError}
                      t={t}
                    >
                      {card}
                    </ResolvedThreadBar>
                  )}
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
    </section>
  )
}

