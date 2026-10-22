// Derived from multica-x packages/views/issues/components/comment-card.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: upstream's card is one component of a server-bound comment
// API — reactions, resolve, revision-checked edits, copy-link, agent runs and
// steering all arrive as props this client has no equivalent of, and its
// Tailwind classes have no counterpart in the Team Room's CSS-Module world.
// The port keeps the card's shape — a root card with a header, the body, the
// attachment area, and a flat list of replies one indent step below — and
// takes every fact from props. The reply tree is one level deep by the ledger's
// shape, so the port renders one level and invents no deeper tree.

import { Fragment, useMemo } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMessageAttachment } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { TeamAttachmentStrip } from '../attachment-strip.tsx'
import { formatAbsoluteTime, formatMessageTime, planMessageBody, type MentionHandle } from '../team-formatters.ts'
import { ActorAvatar } from '../multica-ui/ActorAvatar.tsx'
import look from '../multica-look.module.css'
import css from './comment-card.module.css'

/** Who wrote one comment: the roster already holds every fact about them. */
export interface CommentCardAuthor {
  readonly name: string
  readonly kind: 'agent' | 'human'
  /** The Human's own picture; Agents draw their seat's glyph. */
  readonly avatarUrl?: string | undefined
  /** The seat's description, shown as the name's tooltip. */
  readonly title?: string | undefined
}

/** One reply: a row under its parent, with the message it answers. */
export interface CommentCardReply {
  readonly author: CommentCardAuthor
  readonly body: string
  /** The Human's input stays literal text; an Agent's body renders as Markdown. */
  readonly human: boolean
  readonly occurredAt: string
  readonly mentionNames?: readonly MentionHandle[] | undefined
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  /** The message this reply answers, as the Host resolved it. */
  readonly replyTo?: { readonly senderName: string; readonly excerpt: string } | undefined
}

export interface CommentCardProps {
  readonly author: CommentCardAuthor
  readonly body: string
  /** The Human's input stays literal text; an Agent's body renders as Markdown. */
  readonly human: boolean
  readonly occurredAt: string
  readonly mentionNames?: readonly MentionHandle[] | undefined
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  /** Cache readback for thumbnails; absent on surfaces without the remotes. */
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  /** The message this comment answers, as the Host resolved it. */
  readonly replyTo?: { readonly senderName: string; readonly excerpt: string } | undefined
  /** The replies under this comment. Never nested deeper than one level. */
  readonly replies?: readonly CommentCardReply[] | undefined
  /** Answers this comment; the composer takes the message as its target. */
  readonly onReply?: (() => void) | undefined
  readonly t?: TeamConversationProps['t'] | undefined
}

/**
 * One comment of the issue's thread: the root card, with its replies under it.
 *
 * The card is the issue's comment presentation — the same facts the Thread page
 * shows as a chat, in an issue layout. It renders what the Host recorded: the
 * author, the instant, the body and the attachments, and it never re-derives
 * any of them.
 */
export function CommentCard({ author, body, human, occurredAt, mentionNames, attachments, loadAttachment, replyTo, replies, onReply, t }: CommentCardProps) {
  return (
    <article className={[look.multicaLook, css.card].join(' ')} data-comment-card="">
      <header className={css.header}>
        <ActorAvatar name={author.name} kind={author.kind} {...(author.avatarUrl === undefined ? {} : { avatarUrl: author.avatarUrl })} size="sm" />
        <span className={css.name} {...(author.title === undefined ? {} : { title: author.title })}>{author.name}</span>
        <time className={css.time} dateTime={occurredAt} title={formatAbsoluteTime(occurredAt)}>{formatMessageTime(occurredAt)}</time>
        {onReply !== undefined && (
          <button type="button" className={css.replyAction} data-comment-reply="" onClick={onReply}>
            {t?.('replyMessage') ?? 'Reply'}
          </button>
        )}
      </header>
      {replyTo !== undefined && <p className={css.quote} data-comment-quote="">
        <span className={css.quoteAuthor}>{replyTo.senderName}</span>
        <span className={css.quoteText}>{replyTo.excerpt}</span>
      </p>}
      <CommentBody body={body} human={human} {...(mentionNames === undefined ? {} : { mentionNames })} t={t} />
      {attachments !== undefined && attachments.length > 0 && (
        <div className={css.attachments}>
          <TeamAttachmentStrip attachments={attachments} {...(loadAttachment === undefined ? {} : { loadAttachment })} {...(t === undefined ? {} : { t })} />
        </div>
      )}
      {replies !== undefined && replies.length > 0 && (
        <div className={css.replies} data-comment-replies="">
          {replies.map((reply, index) => <CommentRow key={index} {...reply} {...(loadAttachment === undefined ? {} : { loadAttachment })} t={t} />)}
        </div>
      )}
    </article>
  )
}

/** One reply row: the same card, one indent step below its parent. */
export function CommentRow({ author, body, human, occurredAt, mentionNames, attachments, loadAttachment, replyTo, t }: CommentCardReply & {
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
}) {
  return (
    <div className={css.reply} data-comment-reply-row="">
      <header className={css.header}>
        <ActorAvatar name={author.name} kind={author.kind} {...(author.avatarUrl === undefined ? {} : { avatarUrl: author.avatarUrl })} size="sm" />
        <span className={css.name} {...(author.title === undefined ? {} : { title: author.title })}>{author.name}</span>
        <time className={css.time} dateTime={occurredAt} title={formatAbsoluteTime(occurredAt)}>{formatMessageTime(occurredAt)}</time>
      </header>
      {replyTo !== undefined && <p className={css.quote} data-comment-quote="">
        <span className={css.quoteAuthor}>{replyTo.senderName}</span>
        <span className={css.quoteText}>{replyTo.excerpt}</span>
      </p>}
      <CommentBody body={body} human={human} {...(mentionNames === undefined ? {} : { mentionNames })} t={t} />
      {attachments !== undefined && attachments.length > 0 && (
        <div className={css.attachments}>
          <TeamAttachmentStrip attachments={attachments} {...(loadAttachment === undefined ? {} : { loadAttachment })} {...(t === undefined ? {} : { t })} />
        </div>
      )}
    </div>
  )
}

/**
 * One comment body. The Human's input stays literal text; an Agent's body
 * renders as Markdown. Structured mentions chip where the body spells them and
 * fall back to a chip row when they do not.
 */
function CommentBody({ body, human, mentionNames, t }: {
  readonly body: string
  readonly human: boolean
  readonly mentionNames?: readonly MentionHandle[] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
}) {
  const plan = useMemo(() => planMessageBody(body, { human, ...(mentionNames === undefined ? {} : { mentionNames }), canOpenRefs: false }), [body, human, mentionNames])
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t?.('copyCode') ?? 'Copy', copiedLabel: t?.('copiedCode') ?? 'Copied' },
    footnotes: t?.('markdownFootnotes') ?? 'Footnotes',
  }), [t])
  if (plan.render === 'inline') {
    return <div className={css.body} data-comment-body="">
      {plan.inline!.segments.map((segment, index) => segment.mention
        ? <span key={index} className={css.mention}>{segment.text}</span>
        : <Fragment key={index}>{segment.text}</Fragment>)}
      {plan.fallbackNames.map(name => <span key={name} className={css.mention}>@{name}</span>)}
    </div>
  }
  if (plan.render === 'literal') {
    return <div className={css.body} data-comment-body="">{plan.displayBody}</div>
  }
  return <div className={css.body} data-comment-body="">
    <MarkdownText text={plan.displayBody} labels={markdownLabels} />
  </div>
}
