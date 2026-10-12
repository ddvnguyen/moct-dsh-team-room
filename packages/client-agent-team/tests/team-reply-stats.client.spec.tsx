// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AgentTeamMemberId } from '@contexera/dsh-agent-team/types'
import { TeamMessage } from '../src/client/TeamMessage.tsx'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { replyStatsView, type ReplyStatsView } from '../src/client/reply-stats.ts'

afterEach(() => { cleanup() })

// English stand-in for the page locale: the row text is the template's output, not a key.
const t = ((key: string, vars?: Record<string, string | number>) => {
  if (key === 'replyStatsTools') return `${vars?.count} tools`
  if (key === 'replyStatsPartialInput') return `${vars?.input}+`
  if (key === 'replyStatsRow') return `${vars?.input} in / ${vars?.output} out · ${vars?.seconds} · cache ${vars?.cache} · ${vars?.tools}`
  return key
}) as unknown as TeamConversationProps['t']

function renderReply(view: ReplyStatsView | undefined) {
  return render(<TeamMessage senderName="builder" memberId={'member:builder' as AgentTeamMemberId} human={false} body="done" t={t} replyStats={view} />)
}

describe('agent reply stats row', () => {
  it('renders the usage line under an agent reply when every bucket is recorded', () => {
    const view = replyStatsView({
      messageRef: 'message:1' as never,
      memberId: 'member:builder' as AgentTeamMemberId,
      isLastOfTurn: true,
      turn: { toolCalls: 7, runMs: 12_000, usage: { uncachedInputTokens: 200, cacheReadTokens: 1_000, cacheWriteTokens: 0, outputTokens: 340, reasoningTokens: null } } as never,
    })
    renderReply(view)
    expect(screen.getByTestId('reply-stats').textContent).toBe('1.2k in / 340 out · 12s · cache 83% · 7 tools')
  })

  it('renders the recorded uncached figure with a plus marker when a cache bucket is null', () => {
    const view = replyStatsView({
      messageRef: 'message:1' as never,
      memberId: 'member:builder' as AgentTeamMemberId,
      isLastOfTurn: true,
      turn: { toolCalls: 7, runMs: 12_000, usage: { uncachedInputTokens: 200, cacheReadTokens: 1_000, cacheWriteTokens: null, outputTokens: 340, reasoningTokens: null } } as never,
    })
    renderReply(view)
    expect(screen.getByTestId('reply-stats').textContent).toBe('200+ in / 340 out · 12s · cache — · 7 tools')
  })

  it('renders the unknown dash for input when the uncached split is null', () => {
    const view = replyStatsView({
      messageRef: 'message:1' as never,
      memberId: 'member:builder' as AgentTeamMemberId,
      isLastOfTurn: true,
      turn: { toolCalls: 7, runMs: 12_000, usage: { uncachedInputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: 340, reasoningTokens: null } } as never,
    })
    renderReply(view)
    expect(screen.getByTestId('reply-stats').textContent).toBe('— in / 340 out · 12s · cache — · 7 tools')
  })

  it('renders no usage line on a reply without a view', () => {
    renderReply(undefined)
    expect(screen.queryByTestId('reply-stats')).toBeNull()
  })
})
