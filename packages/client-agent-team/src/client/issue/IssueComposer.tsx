// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the issue's composer, lifted out of the timeline region
// (M-71) so it can pin to the bottom of the main column while the timeline
// scrolls above it. The write itself did not change: one comment on the Task,
// fenced by the Thread revision, with the draft in the page's own store — the
// region used to own this code, and the seams it writes through are the same
// ones the page hands down.
//
// The write is not optimistic: the Host commits, the row joins the timeline
// from the commit, and the change-wake refetch reconciles the list.

import { useCallback, useState } from 'react'
import type {
  AgentTeamAttachmentId, AgentTeamClientMemberStatus, AgentTeamIssueComment, AgentTeamMemberId, AgentTeamMessageRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamComposer } from '../TeamComposer.tsx'
import { committedCommentFact, type IssueReplyQuote } from './comment-thread.ts'
import { mentionedMemberIds } from '../team-formatters.ts'
import { mintRequestId, uploadComposerFiles } from '../requests.ts'
import type { IssueCommentWrite } from './IssueTimeline.tsx'
import type { TeamConversationProps } from '../slots.ts'

export type { IssueReplyQuote } from './comment-thread.ts'

export interface IssueComposerProps extends IssueCommentWrite {
  /** The seats the composer names. */
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly humanMemberId?: AgentTeamMemberId | undefined
  /** The message the reader is answering, if any. */
  readonly replyTarget?: AgentTeamMessageRef | undefined
  /** Clears or sets the reply target: the timeline's reply buttons write through it. */
  readonly onReplyTarget: (target: AgentTeamMessageRef | undefined) => void
  /** The target's quote, resolved by the view that owns the facts. */
  readonly replyQuote?: IssueReplyQuote | undefined
  /** A locally committed row joins the timeline the moment the Host commits. */
  readonly onPosted: (fact: AgentTeamIssueComment) => void
  readonly t: TeamConversationProps['t']
}

/**
 * The Human's answer box: reply, attachments, draft, mentions. It owns the
 * write's own state — pending, the confirmation, the failure line, the files —
 * and nothing of the timeline's: what it publishes is the committed row and
 * the cleared reply target.
 */
export function IssueComposer({
  members, humanMemberId, replyTarget, onReplyTarget, replyQuote, onPosted, workspaceId, taskRef, baseRevision, reply,
  putAttachment, drafts, loadTriggerCatalog, draftKey, t,
}: IssueComposerProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined)
  const [files, setFiles] = useState<readonly File[]>([])

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
        onPosted(committedCommentFact(committed.message, mentions))
        drafts.clear(draftKey)
        setFiles([])
        onReplyTarget(undefined)
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
  }, [drafts, draftKey, pending, files, putAttachment, workspaceId, reply, taskRef, baseRevision, replyTarget, members, onPosted, onReplyTarget, t])

  return (
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
      {...(replyQuote === undefined ? {} : {
        replyTo: {
          ...(replyQuote.memberId === undefined ? {} : { memberId: replyQuote.memberId }),
          senderName: replyQuote.senderName,
          excerpt: replyQuote.excerpt,
        },
        onCancelReply: () => { onReplyTarget(undefined) },
      })}
      {...(humanMemberId === undefined ? {} : { humanMemberId })}
      t={t}
    />
  )
}
