// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { AgentViewBody, resetAgentSessions } from '../src/client/agent-detail-views.tsx'
import { cacheHitLabel, TeamAgentDetail } from '../src/client/TeamAgentDetail.tsx'
import { sessionState } from '../src/client/session-state.tsx'

afterEach(() => { cleanup(); resetAgentSessions() })

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
const base = { member: { memberId: 'member:b', handle: '@builder', description: '', state: 'active', presetId: 'p', workspaceIds: [], sessionId: 'session:current' }, workspaceIds: ['w1'], availability: 'active' } as const
const status = (over: Record<string, unknown> = {}) => ({ ...base, instances: [], presence: 'available', capabilityState: 'applied', ...over }) as unknown as AgentTeamClientMemberStatus
const run = (sessionId: string, over: Record<string, unknown> = {}) => ({ sessionId, memberId: 'member:b', threadRefs: [], startedAt: 1, endedAt: 2, turns: 3, tokensIn: 100, unknownInputTurns: 0, tokensOut: 5, cacheReadTokens: 300, cacheWriteTokens: 0, reasoningTokens: null, toolCalls: 2, runMs: 1000, model: { provider: 'p', model: 'm' }, lastAssistantAt: 2, ...over })

function remotes(runs: unknown[], openMemberSession = vi.fn(), resolved: unknown[] = []) {
  return {
    loadMembers: vi.fn(async () => ({ ok: true, value: [status()] })),
    loadMemberSessions: vi.fn(async () => ({ ok: true, value: { current: 'session:current', runs } })),
    resolveThreadRefs: vi.fn(async () => ({ ok: true, value: { resolved } })),
    loadMemory: vi.fn(async () => ({ ok: true, value: { ok: true, value: { results: [], total: 0, nextCursor: null } } })),
    loadChannels: vi.fn(async () => ({ ok: true, value: { channels: [{ channelRef: 'channel:1', name: 'general' }] } })),
    openMemberSession,
  } as never
}
const selectThread = vi.fn()
const navigation = { getSnapshot: () => ({ mode: 'team', workspaceId: 'w1' }), subscribe: () => () => {}, actions: () => ({ selectThread }) } as never

describe('Agent Sessions rows (A14 d)', () => {
  it('shows one status icon per row for all four states, named for assistive tech, with no text pill', () => {
    const live = { sessionId: 'session:current' }
    const cases = [
      ['active', status(), 'session:current'],
      ['inactive', status(), 'session:old'],
      ['error', status({ presence: 'error' }), 'session:current'],
      ['pending', status({ capabilityState: 'pending' }), 'session:current'],
    ] as const
    for (const [expected, member, id] of cases) expect(sessionState({ sessionId: id } as never, member, live.sessionId)).toBe(expected)
    // an instance slot's own Session is live too, and a slot error is that row's error
    expect(sessionState({ sessionId: 'session:slot1' } as never, status({ instances: [{ slot: 1, sessionId: 'session:slot1', presence: 'error', threadRefs: [] }] }), 'session:current')).toBe('error')
  })

  it('renders the icon with its state as the accessible name and no active text pill', async () => {
    render(<AgentViewBody tab="sessions" sessionId="session:current" remotes={remotes([run('session:current'), run('session:old')])} navigation={navigation} t={t} />)
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    const states = [...document.querySelectorAll('[data-session-id]')].map(row => row.querySelector('[data-session-state]')?.getAttribute('data-session-state'))
    expect(states).toEqual(['active', 'inactive'])
    expect(document.querySelector('[data-session-state="active"]')!.getAttribute('aria-label')).toBe('agentDetailsStateActive')
    expect(document.body.textContent).not.toContain('agentDetailsActive')
  })

  it('pressing the already-open session selects Chat directly, without reopening it', async () => {
    const open = vi.fn()
    const openView = vi.fn()
    render(<AgentViewBody tab="sessions" sessionId="session:current" remotes={remotes([run('session:current'), run('session:old')], open)} navigation={navigation} openView={openView} t={t} />)
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-session-id="session:current"] button')!)
    expect(openView).toHaveBeenCalledWith('chat', '')
    expect(open).not.toHaveBeenCalled()
  })

  it('shows only the first Thread as a link (others in its tooltip, no +N disclosure), and "no thread" for none', async () => {
    const resolved = [{ threadRef: 'thread:1', channelRef: 'channel:1', title: 'Fix login' }, { threadRef: 'thread:2', channelRef: 'channel:1', title: 'Other' }]
    render(<AgentViewBody tab="sessions" sessionId="session:current" remotes={remotes([run('session:current', { threadRefs: ['thread:1', 'thread:2'] }), run('session:old')], vi.fn(), resolved)} navigation={navigation} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-run-thread="thread:1"]')).not.toBeNull())
    expect(document.querySelector('[data-run-more-threads]')).toBeNull()
    expect(document.querySelectorAll('[data-run-thread]')).toHaveLength(1)
    expect(document.querySelector('[data-run-thread="thread:1"]')!.getAttribute('title')).toContain('Other')
    expect(document.querySelector('[data-session-id="session:old"] [data-run-no-thread]')!.textContent).toBe('agentDetailsNoThread')
    fireEvent.click(document.querySelector('[data-run-thread="thread:1"]')!)
    expect(selectThread).toHaveBeenCalledWith('thread:1', 'channel:1', undefined, undefined)
  })

  it('shows the full Session id on every row (ids sharing a prefix stay distinguishable) and one start time', async () => {
    const a = 'agent-team-11111111-aaaa-bbbb-cccc-000000000001'
    const b = 'agent-team-22222222-aaaa-bbbb-cccc-000000000002'
    render(<AgentViewBody tab="sessions" sessionId="session:current" remotes={remotes([run(a), run(b)])} navigation={navigation} t={t} />)
    await waitFor(() => expect(document.querySelectorAll('[data-session-id-label]')).toHaveLength(2))
    const labels = [...document.querySelectorAll('[data-session-id-label]')]
    expect(labels.map(label => label.textContent)).toEqual([a, b])
    expect(labels.map(label => label.getAttribute('title'))).toEqual([a, b])
    expect(document.querySelector(`[data-session-id="${a}"] [data-run-place]`)!.textContent).not.toContain('→')
  })

  it('lists tokens in/out, cache hit, run time, tools and turns, with em dash for null and the partial marker kept', async () => {
    render(<AgentViewBody tab="sessions" sessionId="session:current" remotes={remotes([run('session:current'), run('session:nulls', { cacheReadTokens: null, unknownInputTurns: 1 })])} navigation={navigation} t={t} />)
    await waitFor(() => expect(document.querySelectorAll('[data-run-stats]')).toHaveLength(2))
    const text = (id: string): string => document.querySelector(`[data-session-id="${id}"] [data-run-stats]`)!.textContent!
    expect(text('session:current')).toContain('75%') // 300 / (100 + 300)
    expect(text('session:current')).toContain('1s')
    expect(text('session:nulls')).toContain('—')
    expect(document.querySelector('[data-session-id="session:nulls"]')!.textContent).toContain('agentDetailsPartial')
    expect(cacheHitLabel({ tokensIn: 0, cacheReadTokens: 0 })).toBe('—')
  })

  it('TeamAgentDetail alone keeps working without a view selector (legacy mount)', async () => {
    render(<TeamAgentDetail workspaceId={'w1' as never} status={status()} loadMemberSessions={vi.fn(async () => ({ ok: true, value: { current: null, runs: [run('session:x')] } })) as never} resolveThreadRefs={vi.fn() as never} loadMemory={vi.fn() as never} loadChannels={vi.fn() as never} openMemberSession={vi.fn() as never} t={t} />)
    await waitFor(() => expect(document.querySelectorAll('[data-session-id]')).toHaveLength(1))
  })
})
