// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  AgentTeamAttachmentId, AgentTeamClientMemberStatus, AgentTeamIssueComment, AgentTeamIssueComments, AgentTeamIssueDecision,
  AgentTeamMemberId, AgentTeamMessageRef, AgentTeamTaskRef, AgentTeamThreadFact,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import { IssueComments, type IssueCommentsProps } from '../src/client/issue/IssueComments.tsx'
import { TeamDraftStore } from '../src/client/drafts.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

const translate = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}) as unknown as TeamConversationProps['t']

const workspaceId = 'workspace:alpha' as WorkspaceId
const taskRef = 'task:1' as AgentTeamTaskRef
const human = 'member:human' as AgentTeamMemberId
const ann = 'member:ann' as AgentTeamMemberId

const member = (id: string, handle: string): AgentTeamClientMemberStatus => ({
  member: { memberId: id, handle, description: 'Builds things', state: 'active', presetId: 'p', workspaceIds: [], sessionId: 'session:' + id },
} as unknown as AgentTeamClientMemberStatus)

const members = [member(human, '@dvnguyen'), member(ann, '@ann'), member('member:bob' as AgentTeamMemberId, '@bob')]
const mentionHandles = new Map(members.map(status => [status.member.memberId, status.member.handle]))
const nameOf = (id: AgentTeamMemberId): string => (id === human ? 'Ddv' : `@${mentionHandles.get(id) ?? 'member'}`)

function messageFact(sequence: number, ref: string, body: string, sender: AgentTeamMemberId = ann, extra?: { readonly replyToMessageRef?: AgentTeamMessageRef; readonly attachments?: readonly { readonly attachmentId: AgentTeamAttachmentId; readonly name: string; readonly byteSize: number; readonly mediaType: string }[] }): AgentTeamIssueComment {
  return {
    kind: 'message',
    sequence,
    message: {
      messageRef: ref as AgentTeamMessageRef, channelRef: 'channel:room' as never, threadRef: 'thread:plan' as never, taskRef: 'task:1' as never,
      sender, body, sequence, occurredAt: `2026-10-22T0${Math.min(sequence, 9)}:00:00.000Z`,
      topLevel: false,
      ...(extra?.replyToMessageRef === undefined ? {} : { replyToMessageRef: extra.replyToMessageRef }),
      ...(extra?.attachments === undefined ? {} : { attachments: extra.attachments }),
    },
    mentions: [],
    occurredAt: `2026-10-22T0${Math.min(sequence, 9)}:00:00.000Z`,
  }
}

function region(items: readonly AgentTeamIssueComment[], hasMore = false): AgentTeamIssueComments {
  return { items, hasMore, cursor: items[0]?.message.sequence ?? 0 }
}

function renderComments(overrides: Partial<IssueCommentsProps> = {}) {
  const drafts = new TeamDraftStore()
  const props: IssueCommentsProps = {
    comments: region([]),
    decisions: [],
    nameOf,
    humanMemberId: human,
    humanName: 'Ddv',
    mentionHandles,
    workspaceId,
    taskRef,
    baseRevision: 7,
    onLoadOlder: vi.fn(),
    loadingOlder: false,
    members,
    reply: vi.fn(async () => ({ ok: true, value: { kind: 'committed' } })) as unknown as IssueCommentsProps['reply'],
    drafts,
    loadTriggerCatalog: vi.fn(async () => []) as unknown as IssueCommentsProps['loadTriggerCatalog'],
    draftKey: 'thread:thread:plan' as never,
    t: translate,
    ...overrides,
  }
  const view = render(<IssueComments {...props} />)
  return { view, props, drafts }
}

/** The bodies of the comment cards, in the order the region renders them. */
function cardBodies(root: HTMLElement): readonly string[] {
  return [...root.querySelectorAll('[data-comment-card]')].map(card => card.querySelector('[data-comment-body]')?.textContent ?? '')
}

describe('IssueComments', () => {
  it('lists the comments oldest first, each as a card with its author and time', () => {
    const { view } = renderComments({
      comments: region([
        messageFact(4, 'message:a', 'first comment'),
        messageFact(9, 'message:b', 'second comment'),
      ]),
    })
    expect(cardBodies(view.container)).toEqual(['first comment', 'second comment'])
    expect(view.container.querySelector('[data-comment-card]')?.textContent).toContain('@ann')
  })

  it('skips the message a decision owns: the decision region renders that ask', () => {
    const ask = messageFact(4, 'message:ask', 'the ask')
    const other = messageFact(9, 'message:b', 'a plain comment')
    const decision: AgentTeamIssueDecision = {
      kind: 'card',
      card: {
        decisionRef: 'decision:1', channelRef: 'channel:room', threadRef: 'thread:plan', asker: ann,
        messageRef: 'message:ask', status: 'open', askedAt: '2026-10-22T04:00:00.000Z', questions: [],
      },
    } as unknown as AgentTeamIssueDecision
    const { view } = renderComments({ comments: region([ask, other]), decisions: [decision] })
    expect(cardBodies(view.container)).toEqual(['a plain comment'])
  })

  it('nests a reply under its parent, one level deep', () => {
    const parent = messageFact(4, 'message:parent', 'the parent')
    const reply = messageFact(9, 'message:reply', 'the reply', ann, { replyToMessageRef: 'message:parent' as AgentTeamMessageRef })
    const { view } = renderComments({ comments: region([parent, reply]) })
    const card = view.container.querySelector('[data-comment-card]') as HTMLElement
    const replies = card.querySelector('[data-comment-replies]') as HTMLElement
    expect(replies.querySelector('[data-comment-reply-row]')?.textContent).toContain('the reply')
    // The reply is inside the parent's card, and no card holds a card.
    expect(cardBodies(view.container)).toEqual(['the parent'])
  })

  it('keeps a reply to a reply at the same single level, never deeper', () => {
    const parent = messageFact(4, 'message:parent', 'the parent')
    const reply = messageFact(9, 'message:reply', 'the reply', ann, { replyToMessageRef: 'message:parent' as AgentTeamMessageRef })
    const deep = messageFact(12, 'message:deep', 'the deep reply', ann, { replyToMessageRef: 'message:reply' as AgentTeamMessageRef })
    const { view } = renderComments({ comments: region([parent, reply, deep]) })
    const card = view.container.querySelector('[data-comment-card]') as HTMLElement
    const rows = card.querySelectorAll('[data-comment-reply-row]')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.textContent).toContain('the deep reply')
    expect(card.querySelectorAll('[data-comment-replies] [data-comment-replies]')).toHaveLength(0)
  })

  it('pages older comments through the page that owns the history read', async () => {
    const onLoadOlder = vi.fn()
    const { view } = renderComments({
      comments: region([messageFact(9, 'message:b', 'a newer comment')], true),
      onLoadOlder,
    })
    fireEvent.click(screen.getByRole('button', { name: zh.issueCommentsMore }))
    expect(onLoadOlder).toHaveBeenCalled()
    expect(cardBodies(view.container)).toEqual(['a newer comment'])
  })

  it('renders an empty state for a Task with no comments', () => {
    const { view } = renderComments({ comments: region([]) })
    expect(view.container.querySelector('[data-issue-comments-empty]')?.textContent).toBe(zh.issueCommentsEmpty)
  })

  it('posts the comment when the write commits, and shows nothing before it does', async () => {
    const reply = vi.fn(async () => ({ ok: true, value: { kind: 'committed', receipt: { sequence: 11 }, message: messageFact(11, 'message:new', 'a new comment').message } })) as unknown as IssueCommentsProps['reply']
    const { view, drafts } = renderComments({ comments: region([messageFact(4, 'message:a', 'first comment')]), reply })
    fireEvent.change(screen.getByLabelText(zh.messageDraft), { target: { value: 'a new comment' } })
    fireEvent.click(screen.getByRole('button', { name: zh.sendMessage }))
    // Nothing is inserted before the write commits.
    expect(cardBodies(view.container)).toEqual(['first comment'])
    await waitFor(() => { expect(reply).toHaveBeenCalledWith(expect.objectContaining({ body: 'a new comment', taskRef: 'task:1', baseRevision: 7 })) })
    await waitFor(() => { expect(cardBodies(view.container)).toEqual(['first comment', 'a new comment']) })
    expect(drafts.getSnapshot('thread:thread:plan' as never).draft).toBe('')
  })

  it('keeps the draft and shows the reason when the write is refused', async () => {
    const reply = vi.fn(async () => ({ ok: false, error: { message: 'stale revision' } })) as unknown as IssueCommentsProps['reply']
    const { view, drafts } = renderComments({ comments: region([messageFact(4, 'message:a', 'first comment')]), reply })
    fireEvent.change(screen.getByLabelText(zh.messageDraft), { target: { value: 'a new comment' } })
    fireEvent.click(screen.getByRole('button', { name: zh.sendMessage }))
    await waitFor(() => { expect(view.container.textContent).toContain('stale revision') })
    expect(drafts.getSnapshot('thread:thread:plan' as never).draft).toBe('a new comment')
    expect(cardBodies(view.container)).toEqual(['first comment'])
  })

  it('renders a comment that carries an attachment', () => {
    const withFile = messageFact(4, 'message:a', 'see the file', ann, {
      attachments: [{ attachmentId: 'attachment:1' as AgentTeamAttachmentId, name: 'report.pdf', byteSize: 1024, mediaType: 'application/pdf' }],
    })
    const { view } = renderComments({ comments: region([withFile]) })
    expect(screen.getByText('report.pdf')).toBeTruthy()
  })
})
