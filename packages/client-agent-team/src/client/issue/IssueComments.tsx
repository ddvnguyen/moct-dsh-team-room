// Derived from multica-x packages/views/issues/components/comment-card.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's comment list — one card per Message, a reply
// under its parent — ported as the issue view's comment region. The Messages
// are the Host's `comments` region: the Host already leaves out the Thread's
// anchor and the ask of every decision card (F8), because the decision region
// owns that ask, so the client renders the region as given and never keeps a
// second rule of its own. dsh replies are one level deep — the Message
// carries `replyToMessageRef` and a `topLevel` flag, and there is no deeper
// tree to draw.

import type { AgentTeamIssueComments, AgentTeamMemberId, AgentTeamMessageRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamMessage } from '../TeamMessage.tsx'
import { mentionNamesOf, type MentionHandle } from '../team-formatters.ts'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueCommentsProps {
  /** The Host's comment region: the Messages, oldest first, the anchor excluded. */
  readonly comments: AgentTeamIssueComments
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
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's comment thread: the Task's Messages in the order they were
 * written, with the replies under the Message they answer.
 */
export function IssueComments({ comments, nameOf, humanMemberId, humanName, mentionHandles, onLoadOlder, loadingOlder, t }: IssueCommentsProps) {
  const byRef = new Map<AgentTeamMessageRef, number>()
  comments.items.forEach((fact, index) => { byRef.set(fact.message.messageRef, index) })
  return (
    <section className={css.region} aria-label={t('issueCommentsLabel')}>
      <h2 className={css.regionHeading}>{t('issueCommentsLabel')}</h2>
      {comments.items.length === 0
        ? <p className={css.empty}>{t('issueCommentsEmpty')}</p>
        : <div className={css.commentList}>
            {comments.items.map(fact => {
              const parent = fact.message.replyToMessageRef
              const parentIndex = parent === undefined ? undefined : byRef.get(parent)
              const reply = parentIndex !== undefined && parentIndex < comments.items.length - 1
              const mentionNames: readonly MentionHandle[] = mentionNamesOf(fact.mentions, mentionHandles, humanName)
              return (
                <div className={reply ? css.reply : undefined} key={fact.message.messageRef}>
                  <TeamMessage
                    senderName={nameOf(fact.message.sender)}
                    memberId={fact.message.sender}
                    human={fact.message.sender === humanMemberId}
                    body={fact.message.body}
                    occurredAt={fact.occurredAt}
                    mentionNames={mentionNames}
                    messageRef={fact.message.messageRef}
                    t={t}
                  />
                </div>
              )
            })}
          </div>}
      {comments.hasMore && <button type="button" className={css.moreButton} disabled={loadingOlder} onClick={onLoadOlder}>
        {loadingOlder ? t('issueCommentsLoading') : t('issueCommentsMore')}
      </button>}
    </section>
  )
}
