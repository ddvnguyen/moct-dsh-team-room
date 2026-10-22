import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentTeamAttachmentId, AgentTeamClientMemberStatus, AgentTeamIssueComment, AgentTeamIssueComments, AgentTeamIssueDecision,
  AgentTeamMemberId, AgentTeamMessageRef, AgentTeamTask, AgentTeamThread,
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
import css from './issue-comments.module.css'

/** The page size of one older-comments page. The Host accepts 1–100. */
const PAGE_SIZE = 20

export interface IssueCommentsProps {
  readonly workspaceId: WorkspaceId
  /** The Task and the Thread it hangs on; the Thread's revision fences the write. */
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  /** The contract's comments region: the newest window, oldest-first. */
  readonly comments: AgentTeamIssueComments
  /** The contract's decisions region: the rows that own the ask messages. */
  readonly decisions: readonly AgentTeamIssueDecision[]
  /** The roster: names, handles and descriptions for the cards. */
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly humanMemberId?: AgentTeamMemberId | undefined
  readonly humanName?: string | undefined
  readonly humanAvatarUrl?: string | undefined
  /** One paging path: the same history seam the Thread page pages with. */
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  /** The write: one comment on the issue. */
  readonly reply: TeamConversationProps['reply']
  readonly putAttachment?: TeamConversationProps['putAttachment'] | undefined
  readonly getAttachment?: TeamConversationProps['getAttachment'] | undefined
  /** Quote context for the replies whose parent is not on screen. */
  readonly resolveMessageRefs?: TeamConversationProps['resolveMessageRefs'] | undefined
  readonly drafts: TeamDraftStore
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  readonly draftKey: TeamDraftKey
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's comment region: the Task's messages as comment cards, the
 * replies under their parent, and the composer the Human answers in.
 *
 * The region reads the contract's comments region and pages the same facts the
 * Thread page pages — one store, two views. It never keeps a second copy of
 * the Task's comments, and it never re-derives what the Host recorded.
 */
export function IssueComments({
  workspaceId, task, thread, comments, decisions, members, humanMemberId, humanName = '', humanAvatarUrl,
  loadThreadHistory, reply, putAttachment, getAttachment, resolveMessageRefs, drafts, loadTriggerCatalog, draftKey, t,
}: IssueCommentsProps) {
  const [older, setOlder] = useState<readonly AgentTeamIssueComment[]>([])
  const [olderCursor, setOlderCursor] = useState<number | undefined>(undefined)
  const [olderHasMore, setOlderHasMore] = useState(false)
  const [posted, setPosted] = useState<readonly AgentTeamIssueComment[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined)
  const [replyTarget, setReplyTarget] = useState<AgentTeamMessageRef | undefined>(undefined)
  const [files, setFiles] = useState<readonly File[]>([])

  const askRefs = useMemo(() => decisionAskMessageRefs(decisions), [decisions])
  // One list: the window the contract carries, the older pages, and the rows
  // this surface committed since. A message present in two of them is one row.
  const facts = useMemo(() => mergeComments([...comments.items, ...older, ...posted]), [comments.items, older, posted])
  const tree = useMemo(() => buildCommentThread(facts, askRefs), [facts, askRefs])

  const handles = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')])), [members])
  const nameOf = useCallback((memberId: AgentTeamMemberId): string => {
    if (memberId === humanMemberId) return humanName
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? t('memberUnknown') : `@${status.member.handle}`
  }, [members, humanMemberId, humanName, t])
  const titleOf = useCallback((memberId: AgentTeamMemberId): string | undefined =>
    members.find(candidate => candidate.member.memberId === memberId)?.member.description, [members])

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

  const hasMore = olderCursor === undefined ? comments.hasMore : olderHasMore
  const pagingCursor = olderCursor ?? comments.cursor

  const loadOlder = useCallback(async (): Promise<void> => {
    if (loadingOlder || !hasMore) return
    setLoadingOlder(true)
    setError(undefined)
    try {
      const result = await loadThreadHistory({ workspaceId, taskRef: task.taskRef, beforeSequence: pagingCursor, limit: PAGE_SIZE })
      if (!result.ok) { setError(result.error.message); return }
      const anchorRef = result.value.anchor.messageRef
      const page = result.value.facts.filter((fact): fact is AgentTeamIssueComment =>
        fact.kind === 'message' && fact.message.messageRef !== anchorRef && !askRefs.has(fact.message.messageRef))
      setOlder(current => mergeComments([...current, ...page]))
      setOlderCursor(result.value.cursor)
      setOlderHasMore(result.value.hasMore)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, hasMore, pagingCursor, loadThreadHistory, workspaceId, task.taskRef, askRefs])

  const mentionNamesOfFact = useCallback((fact: AgentTeamIssueComment): readonly MentionHandle[] =>
    mentionNamesOf(fact.mentions, handles, humanName), [handles, humanName])

  const repliesOf = useCallback((root: AgentTeamIssueComment): readonly CommentCardReply[] => {
    const node = tree.roots.find(candidate => candidate.fact.message.messageRef === root.message.messageRef)
    if (node === undefined) return []
    return node.replies.map(reply => ({
      author: {
        name: nameOf(reply.fact.message.sender),
        kind: reply.fact.message.sender === humanMemberId ? 'human' : 'agent',
        ...(reply.fact.message.sender === humanMemberId && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {}),
        ...(titleOf(reply.fact.message.sender) === undefined ? {} : { title: titleOf(reply.fact.message.sender) }),
      },
      body: reply.fact.message.body,
      human: reply.fact.message.sender === humanMemberId,
      occurredAt: reply.fact.message.occurredAt,
      mentionNames: mentionNamesOfFact(reply.fact),
      attachments: reply.fact.message.attachments,
      ...(reply.fact.message.replyToMessageRef === undefined ? {} : { replyTo: quoteOf(reply.fact.message.replyToMessageRef) }),
    }))
  }, [tree, nameOf, humanMemberId, humanAvatarUrl, titleOf, mentionNamesOfFact, quoteOf])

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
        taskRef: task.taskRef,
        body: draft.trim(),
        baseRevision: thread.revision,
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
  }, [drafts, draftKey, pending, files, putAttachment, workspaceId, reply, task.taskRef, thread.revision, replyTarget, members, t])

  const replyParent = replyTarget === undefined ? undefined : quoteOf(replyTarget)
  const replyParentMember = replyTarget === undefined ? undefined : factByRef.get(replyTarget)?.message.sender

  return (
    <section className={css.region} data-issue-comments="">
      <h2 className={css.heading}>{t('issueCommentsTitle')}</h2>
      {tree.roots.length === 0
        ? <p className={css.empty} data-issue-comments-empty="">{t('issueCommentsEmpty')}</p>
        : (
          <div className={css.list} data-issue-comment-list="">
            {tree.roots.map(root => {
              const fact = root.fact
              const author = {
                name: nameOf(fact.message.sender),
                kind: fact.message.sender === humanMemberId ? 'human' as const : 'agent' as const,
                ...(fact.message.sender === humanMemberId && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {}),
                ...(titleOf(fact.message.sender) === undefined ? {} : { title: titleOf(fact.message.sender) }),
              }
              return (
                <CommentCard
                  key={fact.message.messageRef}
                  author={author}
                  body={fact.message.body}
                  human={fact.message.sender === humanMemberId}
                  occurredAt={fact.message.occurredAt}
                  mentionNames={mentionNamesOfFact(fact)}
                  attachments={fact.message.attachments}
                  {...(getAttachment === undefined ? {} : { loadAttachment: getAttachment })}
                  {...(fact.message.replyToMessageRef === undefined ? {} : { replyTo: quoteOf(fact.message.replyToMessageRef) })}
                  replies={repliesOf(fact)}
                  onReply={() => { setReplyTarget(fact.message.messageRef) }}
                  t={t}
                />
              )
            })}
          </div>
        )}
      {hasMore && (
        <button type="button" className={css.loadOlder} data-issue-comments-load-older="" disabled={loadingOlder} onClick={() => { void loadOlder() }}>
          {loadingOlder ? t('issueCommentsLoading') : t('issueCommentsLoadOlder')}
        </button>
      )}
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
