// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  AgentTeamClientMemberStatus, AgentTeamIssueComment, AgentTeamMemberId, AgentTeamTaskRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import { IssueComposer, type IssueComposerProps } from '../src/client/issue/IssueComposer.tsx'
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

const members = [member(human, '@dvnguyen'), member(ann, '@ann')]

/** The Message a committed write answers with: the row the timeline will show. */
function committedMessage(body: string): AgentTeamIssueComment['message'] {
  return {
    messageRef: 'message:new' as AgentTeamIssueComment['message']['messageRef'],
    channelRef: 'channel:room' as never,
    threadRef: 'thread:plan' as never,
    taskRef,
    sender: human,
    body,
    sequence: 11,
    occurredAt: '2026-10-22T09:00:00.000Z',
    topLevel: true,
  }
}

function renderComposer(overrides: Partial<IssueComposerProps> = {}) {
  const drafts = new TeamDraftStore()
  const reply = vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' as const, receipt: { sequence: 11 } as never, message: committedMessage('a new comment') } }))
  const onPosted = vi.fn()
  const props: IssueComposerProps = {
    workspaceId,
    taskRef,
    baseRevision: 7,
    reply: reply as unknown as IssueComposerProps['reply'],
    drafts,
    loadTriggerCatalog: vi.fn(async () => []) as unknown as IssueComposerProps['loadTriggerCatalog'],
    draftKey: 'thread:thread:plan' as never,
    members,
    onPosted,
    onReplyTarget: vi.fn(),
    t: translate,
    ...overrides,
  }
  const view = render(<IssueComposer {...props} />)
  return { view, props, drafts }
}

const submit = (body: string): void => {
  fireEvent.change(screen.getByLabelText(zh.messageDraft), { target: { value: body } })
  fireEvent.click(screen.getByRole('button', { name: zh.sendMessage }))
}

describe('the issue composer', () => {
  it('publishes the row only once the write commits, then clears the draft', async () => {
    const { props, drafts } = renderComposer()
    submit('a new comment')
    // Nothing joins the timeline before the Host says it committed.
    expect(props.onPosted).not.toHaveBeenCalled()
    await waitFor(() => { expect(props.reply).toHaveBeenCalledWith(expect.objectContaining({ body: 'a new comment', taskRef: 'task:1', baseRevision: 7 })) })
    await waitFor(() => { expect(props.onPosted).toHaveBeenCalledTimes(1) })
    expect(drafts.getSnapshot('thread:thread:plan' as never).draft).toBe('')
  })

  it('keeps the draft and shows the reason when the write is refused', async () => {
    const reply = vi.fn(async () => ({ ok: false as const, error: { message: 'stale revision' } }))
    const { view, props, drafts } = renderComposer({ reply: reply as unknown as IssueComposerProps['reply'] })
    submit('a new comment')
    await waitFor(() => { expect(view.container.textContent).toContain('stale revision') })
    // The refusal is a business outcome: the words stay where they were.
    expect(props.onPosted).not.toHaveBeenCalled()
    expect(drafts.getSnapshot('thread:thread:plan' as never).draft).toBe('a new comment')
    expect((screen.getByLabelText(zh.messageDraft) as HTMLTextAreaElement).value).toBe('a new comment')
  })

  it('answers the message the reader replied to, and drops the reply on cancel', () => {
    const onReplyTarget = vi.fn()
    renderComposer({
      replyTarget: 'message:a' as never,
      replyQuote: { senderName: 'ann', excerpt: 'first comment', memberId: ann },
      onReplyTarget,
    })
    expect(screen.getByText(/first comment/)).toBeTruthy()
    const cancel = screen.getByRole('button', { name: zh.cancelReply })
    fireEvent.click(cancel)
    expect(onReplyTarget).toHaveBeenCalledWith(undefined)
  })
})
