// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  AgentTeamAttachmentId, AgentTeamClientMemberStatus, AgentTeamIssueActivity, AgentTeamIssueActivityFact, AgentTeamIssueComment,
  AgentTeamIssueComments, AgentTeamIssueDecision, AgentTeamMemberId, AgentTeamMessageRef, AgentTeamSessionRun, AgentTeamTaskRef,
  AgentTeamThreadSessionRuns,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import { IssueTimeline, type IssueTimelineProps } from '../src/client/issue/IssueTimeline.tsx'
import { quoteResolver } from '../src/client/issue/comment-thread.ts'
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

/** The instant one ledger row happened: `0N` so the hour orders like the sequence. */
const at = (hour: number): string => `2026-10-22T0${hour}:00:00.000Z`

function messageFact(sequence: number, ref: string, body: string, sender: AgentTeamMemberId = ann, extra?: {
  readonly replyToMessageRef?: AgentTeamMessageRef
  readonly attachments?: readonly { readonly attachmentId: AgentTeamAttachmentId; readonly name: string; readonly byteSize: number; readonly mediaType: string }[]
  readonly resolved?: { readonly memberId: AgentTeamMemberId; readonly resolvedAt: string }
}): AgentTeamIssueComment {
  return {
    kind: 'message',
    sequence,
    message: {
      messageRef: ref as AgentTeamMessageRef, channelRef: 'channel:room' as never, threadRef: 'thread:plan' as never, taskRef: 'task:1' as never,
      sender, body, sequence, occurredAt: at(Math.min(sequence, 9)),
      topLevel: false,
      ...(extra?.replyToMessageRef === undefined ? {} : { replyToMessageRef: extra.replyToMessageRef }),
      ...(extra?.attachments === undefined ? {} : { attachments: extra.attachments }),
    },
    mentions: [],
    occurredAt: at(Math.min(sequence, 9)),
    ...(extra?.resolved === undefined ? {} : { resolved: extra.resolved }),
  }
}

function activityFact(sequence: number, hour: number): AgentTeamIssueActivityFact {
  return {
    kind: 'activity',
    sequence,
    occurredAt: at(hour),
    activity: {
      kind: 'promote',
      actor: human,
      sequence,
      activityRef: `activity:${sequence}` as never,
      taskRef: 'task:1' as never,
      threadRef: 'thread:plan' as never,
    },
  }
}

function region(items: readonly AgentTeamIssueComment[], hasMore = false): AgentTeamIssueComments {
  return { items, hasMore, cursor: items[0]?.message.sequence ?? 0 }
}

const noActivity: AgentTeamIssueActivity = { items: [], hasMore: false }

function sessionRun(sessionId: string, startedAt: string, endedAt: string): AgentTeamSessionRun {
  return {
    sessionId: sessionId as never, memberId: ann, threadRefs: ['thread:plan' as never],
    startedAt, endedAt, turns: 1, tokensIn: 0, unknownInputTurns: 0, tokensOut: 0,
    cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, toolCalls: 0,
    runMs: Date.parse(endedAt) - Date.parse(startedAt), model: null, lastAssistantAt: endedAt,
  }
}

function renderTimeline(overrides: Partial<IssueTimelineProps> = {}) {
  const comments = overrides.comments ?? region([])
  const props: IssueTimelineProps = {
    workspaceId,
    taskRef,
    baseRevision: 7,
    resolveComment: vi.fn(async () => ({ ok: true, value: { kind: 'committed', messageRef: 'message:a', threadRef: 'thread:plan' } })) as unknown as IssueTimelineProps['resolveComment'],
    comments,
    // The rows the view resolves: this harness posts nothing, so the region's
    // own page is the list — and the quote runs through the view's resolver.
    facts: comments.items,
    quoteOf: quoteResolver(new Map(comments.items.map(fact => [fact.message.messageRef, fact])), nameOf),
    onReply: vi.fn(),
    activity: noActivity,
    runs: [],
    failures: [],
    decisions: [],
    nameOf,
    humanMemberId: human,
    humanName: 'Ddv',
    mentionHandles,
    onLoadOlder: vi.fn(),
    loadingOlder: false,
    members,
    openMemberSession: vi.fn(),
    variant: 'page',
    t: translate,
    ...overrides,
  }
  const view = render(<IssueTimeline {...props} />)
  return { view, props }
}

/** The bodies of the comment cards, in the order the region renders them. */
function cardBodies(root: HTMLElement): readonly string[] {
  return [...root.querySelectorAll('[data-comment-card]')].map(card => card.querySelector('[data-comment-body]')?.textContent ?? '')
}

/** Every timeline row, in order, named by what it is. */
function rows(root: HTMLElement): readonly string[] {
  const list = root.querySelector('[data-issue-timeline-list]')
  if (list === null) return []
  return [...list.children].map((node) => {
    if (node.hasAttribute('data-message-ref')) return `comment:${node.getAttribute('data-message-ref')}`
    if (node.hasAttribute('data-issue-activity-group')) return 'group'
    if (node.hasAttribute('data-issue-run')) return 'run'
    return 'other'
  })
}

describe('IssueTimeline', () => {
  it('lists the comments oldest first, each as a card with its author and time', () => {
    const { view } = renderTimeline({
      comments: region([messageFact(4, 'message:a', 'first comment'), messageFact(9, 'message:b', 'second comment')]),
    })
    expect(cardBodies(view.container)).toEqual(['first comment', 'second comment'])
    expect(view.container.querySelector('[data-comment-card]')?.textContent).toContain('@ann')
  })

  it('places an activity between the two comments it happened between', () => {
    const { view } = renderTimeline({
      comments: region([messageFact(1, 'message:a', 'before'), messageFact(5, 'message:b', 'after')]),
      activity: { items: [activityFact(3, 3)], hasMore: false },
    })
    // One list, not two regions: the promote sits where it happened.
    expect(rows(view.container)).toEqual(['comment:message:a', 'group', 'comment:message:b'])
  })

  it('folds consecutive activities into one group that opens to its facts', () => {
    const { view } = renderTimeline({
      activity: { items: [activityFact(1, 1), activityFact(2, 2)], hasMore: false },
    })
    const group = view.container.querySelector('[data-issue-activity-group]') as HTMLElement
    const toggle = group.querySelector('[data-issue-activity-group-toggle]') as HTMLElement
    expect(toggle.textContent).toContain(zh.issueActivityStatusCount.replace('{count}', '2'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(group.querySelectorAll('[data-issue-activity-row]')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(group.querySelectorAll('[data-issue-activity-row]')).toHaveLength(2)
  })

  it('says when the activity region is bounded', () => {
    const { view } = renderTimeline({ activity: { items: [activityFact(1, 1)], hasMore: true } })
    expect(view.container.querySelector('[data-issue-activity-more]')?.textContent).toBe(zh.issueActivityMore)
  })

  it('skips the message a decision owns: the decision region renders that ask', () => {
    const ask = messageFact(4, 'message:ask', 'the ask')
    const other = messageFact(9, 'message:b', 'a plain comment')
    const decision: AgentTeamIssueDecision = {
      kind: 'card',
      card: {
        decisionRef: 'decision:1', channelRef: 'channel:room', threadRef: 'thread:plan', asker: ann,
        messageRef: 'message:ask', status: 'open', askedAt: at(4), questions: [],
      },
    } as unknown as AgentTeamIssueDecision
    const { view } = renderTimeline({ comments: region([ask, other]), decisions: [decision] })
    expect(cardBodies(view.container)).toEqual(['a plain comment'])
  })

  it('nests a reply under its parent, one level deep', () => {
    const parent = messageFact(4, 'message:parent', 'the parent')
    const reply = messageFact(9, 'message:reply', 'the reply', ann, { replyToMessageRef: 'message:parent' as AgentTeamMessageRef })
    const { view } = renderTimeline({ comments: region([parent, reply]) })
    const card = view.container.querySelector('[data-comment-card]') as HTMLElement
    const replies = card.querySelector('[data-comment-replies]') as HTMLElement
    expect(replies.querySelector('[data-comment-reply-row]')?.textContent).toContain('the reply')
    // The reply is inside the parent's card, and no card holds a card.
    expect(cardBodies(view.container)).toEqual(['the parent'])
  })

  it('stands a reply whose parent is not on screen at root level, with its quote', async () => {
    const orphan = messageFact(9, 'message:orphan', 'the orphaned reply', ann, { replyToMessageRef: 'message:elsewhere' as AgentTeamMessageRef })
    const resolveMessageRefs = vi.fn(async () => ({
      ok: true,
      value: { resolved: [{ messageRef: 'message:elsewhere', threadRef: 'thread:plan', sender: ann, excerpt: 'the parent, off screen' }] },
    })) as unknown as IssueTimelineProps['resolveMessageRefs']
    const { view } = renderTimeline({ comments: region([orphan]), resolveMessageRefs })
    const card = view.container.querySelector('[data-comment-card]') as HTMLElement
    expect(card.getAttribute('data-comment-orphan')).toBe('')
    await waitFor(() => { expect(card.querySelector('[data-comment-quote]')?.textContent).toContain('the parent, off screen') })
  })

  it('pages older comments through the page that owns the history read', () => {
    const onLoadOlder = vi.fn()
    const { view } = renderTimeline({ comments: region([messageFact(9, 'message:b', 'a newer comment')], true), onLoadOlder })
    fireEvent.click(screen.getByRole('button', { name: zh.issueCommentsMore }))
    expect(onLoadOlder).toHaveBeenCalled()
    expect(cardBodies(view.container)).toEqual(['a newer comment'])
  })

  it('drops history older than a partial comment page, so the list has no gap', () => {
    const { view } = renderTimeline({
      comments: region([messageFact(5, 'message:new', 'newest carried')], true),
      activity: { items: [activityFact(1, 1)], hasMore: false },
    })
    expect(rows(view.container)).toEqual(['comment:message:new'])
  })

  it('renders a run inline with its state, agent and duration, and opens the session', () => {
    const live = sessionRun('session:live', at(1), at(1))
    const done = sessionRun('session:done', at(2), '2026-10-22T02:05:00.000Z')
    const runs: readonly AgentTeamThreadSessionRuns[] = [{ memberId: ann, active: live, history: [done, live] }]
    const openMemberSession = vi.fn()
    const { view } = renderTimeline({ runs, openMemberSession })
    // Oldest first: the live run opened before the finished one.
    const rows = [...view.container.querySelectorAll('[data-issue-run]')] as HTMLElement[]
    expect(rows.map(row => row.getAttribute('data-run-state'))).toEqual(['running', 'completed'])
    const finished = rows[1] as HTMLElement
    expect(finished.querySelector('[data-issue-run-state]')?.textContent).toBe(zh.runStateCompleted)
    expect(finished.querySelector('[data-issue-run-duration]')?.textContent).toBe('5m 00s')
    expect(finished.textContent).toContain('@ann')
    // The transcript is not rebuilt: the row hands the run to the dsh session.
    fireEvent.click(within(finished).getByRole('button', { name: zh.issueRunOpenTranscript }))
    expect(openMemberSession).toHaveBeenCalledWith('session:done')
  })

  it('reads a run whose Turn errored as failed', () => {
    const done = sessionRun('session:done', at(2), '2026-10-22T02:05:00.000Z')
    const runs: readonly AgentTeamThreadSessionRuns[] = [{ memberId: ann, active: null, history: [done] }]
    const { view } = renderTimeline({
      runs,
      failures: [{
        sequence: 3, occurredAt: at(3), threadRef: 'thread:plan' as never, memberId: ann,
        handle: 'ann', sessionId: 'session:done' as never, turn: 1, reason: 'boom',
      }],
    })
    expect(view.container.querySelector('[data-issue-run]')?.getAttribute('data-run-state')).toBe('failed')
    expect(view.container.querySelector('[data-issue-run-state]')?.textContent).toBe(zh.runStateFailed)
  })

  it('renders an empty state when the issue has neither comments nor activity', () => {
    const { view } = renderTimeline()
    expect(view.container.querySelector('[data-issue-timeline-empty]')?.textContent).toBe(zh.issueTimelineEmpty)
  })

  it('copies a link to the comment that carries the issue URL', () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { view } = renderTimeline({ comments: region([messageFact(4, 'message:a', 'link me')]) })
    fireEvent.click(view.container.querySelector('[data-comment-copy-link]') as HTMLElement)
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = new URL(String(writeText.mock.calls[0]?.[0]))
    expect(copied.searchParams.get('issue')).toBe('task:1')
    expect(copied.searchParams.get('comment')).toBe('message:a')
  })

  it('resolves a thread through the Host, and only then shows it closed', async () => {
    const resolveComment = vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'committed' as const, receipt: { sequence: 12 }, messageRef: 'message:a' as AgentTeamMessageRef,
        threadRef: 'thread:plan' as never, resolved: { memberId: human, resolvedAt: at(5) } },
    })) as unknown as IssueTimelineProps['resolveComment']
    const { view } = renderTimeline({ comments: region([messageFact(4, 'message:a', 'close me')]), resolveComment })
    // The write is the Host's: the card's own position and fence ride along.
    fireEvent.click(view.container.querySelector('[data-comment-resolve]') as HTMLElement)
    await waitFor(() => {
      expect(resolveComment).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId, taskRef, messageRef: 'message:a', resolved: true, baseRevision: 7,
      }))
    })
    // Nothing moved before the commit: the card was still the card.
    await waitFor(() => { expect(view.container.querySelector('[data-comment-resolved-bar]')).not.toBeNull() })
    expect(view.container.querySelector('[data-comment-card]')).toBeNull()
    expect(view.container.querySelector('[data-comment-resolved-bar]')?.textContent).toContain(zh.issueResolvedThreadBar)
  })

  it('leaves a refused resolve open and says why', async () => {
    const resolveComment = vi.fn(async () => ({ ok: false as const, error: { message: 'only the comment\'s author may resolve' } })) as unknown as IssueTimelineProps['resolveComment']
    const { view } = renderTimeline({ comments: region([messageFact(4, 'message:a', 'close me')]), resolveComment })
    fireEvent.click(view.container.querySelector('[data-comment-resolve]') as HTMLElement)
    await waitFor(() => { expect(view.container.textContent).toContain('only the comment\'s author may resolve') })
    // The state did not move: the thread is still the Host's open thread.
    expect(view.container.querySelector('[data-comment-card]')).not.toBeNull()
    expect(view.container.querySelector('[data-comment-resolved-bar]')).toBeNull()
    expect(view.container.querySelector('[data-comment-resolve]')?.textContent).toBe(zh.issueResolveComment)
  })

  it('reads a stale revision as a business outcome, with the reason', async () => {
    const resolveComment = vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'stale_revision' as const, threadRef: 'thread:plan' as never, expectedRevision: 7, revision: 9 },
    })) as unknown as IssueTimelineProps['resolveComment']
    const { view } = renderTimeline({ comments: region([messageFact(4, 'message:a', 'close me')]), resolveComment })
    fireEvent.click(view.container.querySelector('[data-comment-resolve]') as HTMLElement)
    await waitFor(() => { expect(view.container.textContent).toContain(zh.staleRevision) })
    expect(view.container.querySelector('[data-comment-card]')).not.toBeNull()
  })

  it('collapses a resolved thread to a bar that expands to the full thread', () => {
    const resolved = messageFact(4, 'message:a', 'the closed thread', ann, { resolved: { memberId: human, resolvedAt: at(5) } })
    const reply = messageFact(6, 'message:reply', 'the answer', ann, { replyToMessageRef: 'message:a' as AgentTeamMessageRef })
    const { view } = renderTimeline({ comments: region([resolved, reply]) })

    const bar = view.container.querySelector('[data-comment-resolved-bar]') as HTMLElement
    expect(bar).not.toBeNull()
    // Collapsed: the bar, and no card behind it.
    expect(view.container.querySelector('[data-comment-card]')).toBeNull()
    expect(bar.textContent).toContain(zh.issueCommentResolvedBy.replace('{name}', 'Ddv'))
    const toggle = bar.querySelector('[data-resolved-bar-toggle]') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const body = bar.querySelector('[data-resolved-bar-body]') as HTMLElement
    expect(body.querySelector('[data-comment-body]')?.textContent).toBe('the closed thread')
    expect(body.querySelector('[data-comment-replies]')?.textContent).toContain('the answer')
  })

  it('reopens from the bar and restores the card when the Host answers', async () => {
    const resolved = messageFact(4, 'message:a', 'the closed thread', ann, { resolved: { memberId: human, resolvedAt: at(5) } })
    const resolveComment = vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'committed' as const, receipt: { sequence: 12 }, messageRef: 'message:a' as AgentTeamMessageRef, threadRef: 'thread:plan' as never },
    })) as unknown as IssueTimelineProps['resolveComment']
    const { view } = renderTimeline({ comments: region([resolved]), resolveComment })

    fireEvent.click(view.container.querySelector('[data-comment-reopen]') as HTMLElement)
    await waitFor(() => { expect(resolveComment).toHaveBeenCalledWith(expect.objectContaining({ messageRef: 'message:a', resolved: false })) })
    await waitFor(() => { expect(view.container.querySelector('[data-comment-resolved-bar]')).toBeNull() })
    // The card is back, with its resolve action again.
    expect(view.container.querySelector('[data-comment-card]')?.textContent).toContain('the closed thread')
    expect(view.container.querySelector('[data-comment-resolve]')?.textContent).toBe(zh.issueResolveComment)
  })

  it('lets a fresh view outrank the answer this page wrote', async () => {
    const resolveComment = vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'committed' as const, receipt: { sequence: 12 }, messageRef: 'message:a' as AgentTeamMessageRef,
        threadRef: 'thread:plan' as never, resolved: { memberId: human, resolvedAt: at(5) } },
    })) as unknown as IssueTimelineProps['resolveComment']
    const page = region([messageFact(4, 'message:a', 'close me')])
    const { view, props } = renderTimeline({ comments: page, resolveComment })
    fireEvent.click(view.container.querySelector('[data-comment-resolve]') as HTMLElement)
    await waitFor(() => { expect(view.container.querySelector('[data-comment-resolved-bar]')).not.toBeNull() })

    // The same page, rendered again for any other reason: the answer still
    // bridges it, because the read that carries it has not landed yet.
    view.rerender(<IssueTimeline {...props} loadingOlder />)
    expect(view.container.querySelector('[data-comment-resolved-bar]')).not.toBeNull()

    // Another writer resolved it while this page was open: the fresh read is
    // the authority, so the bar names them and not the local answer.
    view.rerender(<IssueTimeline {...props} comments={region([
      messageFact(4, 'message:a', 'close me', ann, { resolved: { memberId: ann, resolvedAt: at(6) } }),
    ])} />)
    const bar = view.container.querySelector('[data-comment-resolved-bar]') as HTMLElement
    expect(bar.textContent).toContain(zh.issueCommentResolvedBy.replace('{name}', nameOf(ann)))

    // The thread was reopened elsewhere: the next read says open, and the view
    // wins again — the card is back, without waiting for a remount.
    view.rerender(<IssueTimeline {...props} comments={region([messageFact(4, 'message:a', 'close me')])} />)
    expect(view.container.querySelector('[data-comment-resolved-bar]')).toBeNull()
    expect(view.container.querySelector('[data-comment-card]')?.textContent).toContain('close me')
    expect(view.container.querySelector('[data-comment-resolve]')?.textContent).toBe(zh.issueResolveComment)
  })
  it('renders a comment that carries an attachment', () => {
    const withFile = messageFact(4, 'message:a', 'see the file', ann, {
      attachments: [{ attachmentId: 'attachment:1' as AgentTeamAttachmentId, name: 'report.pdf', byteSize: 1024, mediaType: 'application/pdf' }],
    })
    const { view } = renderTimeline({ comments: region([withFile]) })
    expect(screen.getByText('report.pdf')).toBeTruthy()
  })
})
