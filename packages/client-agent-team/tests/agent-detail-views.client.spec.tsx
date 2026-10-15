// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { AgentViewBody, markChatLanding, noteAgentSession, resetAgentSessions } from '../src/client/agent-detail-views.tsx'

afterEach(() => { cleanup(); resetAgentSessions() })

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
const status = (sessionId: string) => ({ member: { memberId: 'member:b', handle: '@builder', description: 'builds', state: 'active', presetId: 'p', workspaceIds: [], sessionId }, instances: [], workspaceIds: ['w1'], availability: 'active', presence: 'available', capabilityState: 'applied' }) as unknown as AgentTeamClientMemberStatus
const run = (sessionId: string) => ({ sessionId, memberId: 'member:b', threadRefs: [], startedAt: 1, endedAt: 2, turns: 3, tokensIn: 10, unknownInputTurns: 0, tokensOut: 5, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, toolCalls: 1, runMs: 1000, model: null, lastAssistantAt: 2 })

function remotes(openMemberSession = vi.fn()) {
  return {
    loadMembers: vi.fn(async () => ({ ok: true, value: [status('session:current')] })),
    loadMemberSessions: vi.fn(async () => ({ ok: true, value: { current: 'session:current', runs: [run('session:old-aaaa'), run('session:current')] } })),
    resolveThreadRefs: vi.fn(async () => ({ ok: true, value: { resolved: [] } })),
    loadMemory: vi.fn(async () => ({ ok: true, value: { ok: true, value: { results: [], total: 0, nextCursor: null } } })),
    loadChannels: vi.fn(async () => ({ ok: true, value: { channels: [] } })),
    openMemberSession,
  } as never
}
const navigation = { getSnapshot: () => ({ mode: 'team', workspaceId: 'w1' }), subscribe: () => () => {} } as never
const mount = (tab: 'sessions' | 'overview' | 'memory', sessionId: string, r = remotes(), openView = vi.fn()) =>
  render(<AgentViewBody tab={tab} sessionId={sessionId} remotes={r} navigation={navigation} openView={openView} t={t} />)

describe('Agent detail conversation tabs (A14)', () => {
  it('finds the Agent behind the open Member Session and lists its runs on the Sessions tab', async () => {
    mount('sessions', 'session:current')
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    expect(document.querySelector('[data-team-agent-detail-body="sessions"]')).not.toBeNull()
    // The tab body is not a Modal and carries no tab strip of its own: the host owns the strip.
    expect(document.querySelector('[role="dialog"], [role="tablist"]')).toBeNull()
  })

  it('renders the Config and Memory bodies alone', async () => {
    const config = mount('overview', 'session:current')
    await waitFor(() => expect(document.querySelector('[data-team-agent-overview]')).not.toBeNull())
    expect(document.querySelector('[data-team-agent-sessions]')).toBeNull()
    config.unmount()
    mount('memory', 'session:current')
    await waitFor(() => expect(document.querySelector('[data-team-agent-memory]')).not.toBeNull())
  })

  it('says so when the open session is not a Team Agent', async () => {
    const r = remotes()
    ;(r as unknown as { loadMembers: ReturnType<typeof vi.fn> }).loadMembers.mockResolvedValue({ ok: true, value: [status('session:other')] })
    mount('sessions', 'session:current', r)
    await waitFor(() => expect(document.body.textContent).toContain('agentDetailsNotAgent'))
  })

  it('pressing a Session row opens that session natively through the Client, noting its Agent', async () => {
    const open = vi.fn()
    mount('sessions', 'session:current', remotes(open))
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-session-id="session:old-aaaa"] button')!)
    expect(open).toHaveBeenCalledWith('session:old-aaaa', expect.any(Function))
  })

  it('a session reached from a row press lands on Chat even when it remembered one of these tabs', async () => {
    const openView = vi.fn()
    markChatLanding('session:current')
    mount('sessions', 'session:current', remotes(), openView)
    await waitFor(() => expect(openView).toHaveBeenCalledWith('chat', ''))
    // One-shot: a later mount of the same tab does not bounce the Human off it again.
    cleanup()
    const again = vi.fn()
    mount('sessions', 'session:current', remotes(), again)
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]').length).toBeGreaterThan(0))
    expect(again).not.toHaveBeenCalled()
  })

  it('a Session the host cannot open is marked not available in the list', async () => {
    const refuse = vi.fn((_id: string, report?: (message: string) => void) => { report?.('retired') })
    noteAgentSession('session:current', { workspaceId: 'w1' as never, memberId: 'member:b' })
    mount('sessions', 'session:current', remotes(refuse))
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-session-id="session:old-aaaa"] button')!)
    await waitFor(() => expect(document.querySelector('[data-session-id="session:old-aaaa"][data-run-unavailable], [data-session-id="session:old-aaaa"] [data-run-unavailable]')).not.toBeNull())
  })
})
