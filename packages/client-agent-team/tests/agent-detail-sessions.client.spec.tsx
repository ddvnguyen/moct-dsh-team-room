// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamAgentDetail, runPlace } from '../src/client/TeamAgentDetail.tsx'

afterEach(cleanup)

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
const status = { member: { memberId: 'member:b', handle: '@builder', description: 'builds', state: 'active', presetId: 'p', workspaceIds: [] }, instances: [], workspaceIds: ['w1'], availability: 'active', presence: 'available', capabilityState: 'applied' } as unknown as AgentTeamClientMemberStatus
const run = (sessionId: string, threadRefs: string[]) => ({ sessionId, memberId: 'member:b', threadRefs, startedAt: 1, endedAt: 2, turns: 3, tokensIn: 10, unknownInputTurns: 0, tokensOut: 5, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, toolCalls: 1, runMs: 1000, model: null, lastAssistantAt: 2 })

describe('runPlace', () => {
  const names = new Map([['channel:1', 'general']])
  it('names the first Thread with its Channel and counts the rest', () => {
    const resolve = () => ({ channelRef: 'channel:1', title: 'Fix login' })
    expect(runPlace({ threadRefs: ['thread:1', 'thread:2', 'thread:3'] as never }, names, resolve)).toEqual({ text: '# general › Fix login', more: 2 })
  })
  it('keeps only the count for a Thread the Host no longer resolves, and nothing for none', () => {
    expect(runPlace({ threadRefs: ['thread:1', 'thread:2'] as never }, names, () => undefined)).toEqual({ text: '', more: 2 })
    expect(runPlace({ threadRefs: [] }, names, () => undefined)).toBeUndefined()
  })
})

describe('Agent detail Sessions tab', () => {
  const mount = (openMemberSession: unknown) => render(<TeamAgentDetail
    workspaceId={'w1' as never}
    status={status}
    loadMemberSessions={vi.fn(async () => ({ ok: true, value: { current: null, runs: [run('session:aaaaaaaa-1', []), run('session:bbbbbbbb-2', [])] } })) as never}
    resolveThreadRefs={vi.fn(async () => ({ ok: true, value: [] })) as never}
    loadMemory={vi.fn(async () => ({ ok: true, value: { results: [], total: 0, nextCursor: null } })) as never}
    loadChannels={vi.fn(async () => ({ ok: true, value: { channels: [] } })) as never}
    openMemberSession={openMemberSession as never}
    onClose={() => undefined}
    t={t}
  />)

  it('lists every run first, then shows the member facts on the Overview tab', async () => {
    mount(vi.fn())
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    fireEvent.click(screen.getByText('agentDetailsTabOverview'))
    expect(document.querySelector('[data-team-agent-overview]')?.textContent).toContain('builds')
    expect(document.querySelector('[data-session-id]')).toBeNull()
  })

  it('says not available on the row when the Client refuses to open that Session', async () => {
    mount(vi.fn((_id: string, onFailure: (m: string) => void) => { onFailure('gone') }))
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-session-id="session:aaaaaaaa-1"] button')!)
    await waitFor(() => expect(document.querySelectorAll('[data-run-unavailable]')).toHaveLength(1))
    expect(document.querySelector('[data-session-id="session:bbbbbbbb-2"] [data-run-unavailable]')).toBeNull()
  })
})
